"use client";

import { useEffect, useState } from "react";
import type { Analysis, BudgetInfo } from "@/lib/types";
import { loadProfile, type Profile } from "@/lib/profile";
import {
  computeOnePageBudget,
  isWithinBudget,
  MAX_TRIM_PASSES,
  visibleChars,
} from "@/lib/latex";
import {
  checkPageCount,
  cutTarget,
  scanAts,
  type AtsScanResult,
} from "@/lib/render";
import { lintLatexForAts, type AtsFinding } from "@/lib/ats/source-lint";
import PageShell from "@/components/PageShell";
import { Region, Note, Notice } from "@/components/Sheet";
import BackendFooter from "@/components/BackendFooter";
import { AnalysisCard, ScorePill } from "@/components/Analysis";
import FitVerdictNotice from "@/components/FitVerdict";
import HonestyPanel, { type HonestVerdict } from "@/components/HonestyPanel";
import LatexResult from "@/components/LatexResult";

type Phase = "input" | "analyzed" | "honesty" | "tailoring" | "tailored";

export default function Home() {
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  const [phase, setPhase] = useState<Phase>("input");
  const [busy, setBusy] = useState<
    | null
    | "analyze"
    | "tailor"
    | "render"
    | "verify"
    | "trim"
    | "ats"
    | "reanalyze"
  >(null);
  const [error, setError] = useState<string | null>(null);

  const [originalAnalysis, setOriginalAnalysis] = useState<Analysis | null>(
    null,
  );
  const [tailoredLatex, setTailoredLatex] = useState<string>("");
  const [tailoredAnalysis, setTailoredAnalysis] = useState<Analysis | null>(
    null,
  );

  const [budgetInfo, setBudgetInfo] = useState<BudgetInfo | null>(null);
  const [ats, setAts] = useState<AtsScanResult | null>(null);
  const [atsFindings, setAtsFindings] = useState<AtsFinding[]>([]);

  // Honesty signals — per missing keyword
  const [honest, setHonest] = useState<Record<string, HonestVerdict>>({});
  const [honestNotes, setHonestNotes] = useState("");

  // Profile from localStorage
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  function loadBaseResume() {
    if (!profile?.baseResumeLatex) return;
    setResume(profile.baseResumeLatex);
  }

  async function analyzeOriginal() {
    setError(null);
    setBusy("analyze");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume, jobDescription }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setOriginalAnalysis(data.analysis);
      setTailoredAnalysis(null);
      setTailoredLatex("");

      // Pre-populate honesty signals: default to "partial" for every missing keyword.
      const initial: Record<string, HonestVerdict> = {};
      for (const k of data.analysis.keyword_coverage.missing as string[]) {
        initial[k] = "partial";
      }
      setHonest(initial);
      setHonestNotes("");

      setPhase("analyzed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function tailor() {
    if (!originalAnalysis) return;
    setError(null);
    setBudgetInfo(null);
    setAts(null);
    setAtsFindings([]);
    setBusy("tailor");
    setPhase("tailoring");
    try {
      // Compute the one-page visible-char budget from the user's original.
      const { budget, originalChars, capped } = computeOnePageBudget(resume);

      const callTailor = (cuts?: string[]) =>
        fetch("/api/tailor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            resume,
            jobDescription,
            analysis: originalAnalysis,
            honest: {
              perKeyword: honest,
              notes: honestNotes.trim() || undefined,
            },
            profileContext: profile
              ? {
                  parsedProfile: profile.parsed,
                  baseCvLatex: profile.parsed ? undefined : profile.baseCvLatex,
                  additionalSkills: profile.additionalSkills,
                }
              : undefined,
            budget,
            cuts,
          }),
        });

      // Multi-pass tailor + render/verify/trim loop. The REAL page count from a
      // compile is authoritative for "fits one page"; the visible-char budget
      // is only a fallback (when rendering is unavailable) and a cut-sizing aid.
      let tailored = "";
      let chars = 0;
      let iterations = 0;
      let allCutsApplied: string[] = [];
      let currentCuts: string[] | undefined = undefined;
      let pages: number | null = null;
      let fits = false;

      while (iterations < MAX_TRIM_PASSES) {
        setBusy(iterations === 0 ? "tailor" : "trim");
        const res = await callTailor(currentCuts);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error ??
              (iterations === 0 ? "Tailoring failed" : "Trim pass failed"),
          );
        }
        tailored = data.latex as string;
        chars = visibleChars(tailored);
        iterations += 1;

        // Authoritative check: compile and count real pages.
        setBusy("render");
        const check = await checkPageCount(tailored);
        pages = check.pages;

        if (check.measured && pages !== null) {
          // Ground truth. One page (or zero, degenerate) → done.
          if (pages <= 1) {
            fits = true;
            break;
          }
          // Genuinely over one page — fall through to request cuts.
        } else {
          // Couldn't render/compile — fall back to the char-budget heuristic.
          if (chars <= budget) {
            fits = true;
            break;
          }
          if (isWithinBudget(chars, budget, 0.005)) {
            fits = true;
            break;
          }
        }

        // Out of passes — surface what we have.
        if (iterations >= MAX_TRIM_PASSES) break;

        // Ask the verifier for fresh cuts against THIS latest LaTeX. Size the
        // target from the real overflow when the heuristic underestimated.
        const overBy = cutTarget(pages, chars - budget, budget);
        setBusy("verify");
        const verifyRes = await fetch("/api/tailor/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            latex: tailored,
            jobDescription,
            budget,
            currentChars: chars,
            overBy,
          }),
        });
        const verifyData = await verifyRes.json();
        if (
          !verifyRes.ok ||
          !Array.isArray(verifyData.suggestedCuts) ||
          verifyData.suggestedCuts.length === 0
        ) {
          break;
        }
        currentCuts = verifyData.suggestedCuts as string[];
        allCutsApplied = [...allCutsApplied, ...currentCuts];
      }

      setTailoredLatex(tailored);
      setBudgetInfo({
        budget,
        originalChars,
        resultChars: chars,
        capped,
        iterations,
        cutsApplied: allCutsApplied,
        pages,
        fits,
      });

      // ATS pass on the FINAL draft only. The tailor path matters most here:
      // the LaTeX is the user's own, so it can carry defects the app never
      // authored and the built-in templates are guaranteed not to have.
      setAtsFindings(lintLatexForAts(tailored));
      setBusy("ats");
      setAts(await scanAts(tailored));

      // Auto-reanalyze the (possibly trimmed) tailored version.
      setBusy("reanalyze");
      const res2 = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume: tailored, jobDescription }),
      });
      const data2 = await res2.json();
      if (!res2.ok) throw new Error(data2.error ?? "Re-analysis failed");
      setTailoredAnalysis(data2.analysis);
      setPhase("tailored");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("honesty");
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setPhase("input");
    setOriginalAnalysis(null);
    setTailoredAnalysis(null);
    setTailoredLatex("");
    setHonest({});
    setHonestNotes("");
    setError(null);
    setBudgetInfo(null);
    setAts(null);
    setAtsFindings([]);
  }

  function setVerdict(keyword: string, v: HonestVerdict) {
    setHonest((prev) => ({ ...prev, [keyword]: v }));
  }
  function setAllVerdicts(v: HonestVerdict) {
    setHonest((prev) => {
      const next: Record<string, HonestVerdict> = {};
      for (const k of Object.keys(prev)) next[k] = v;
      return next;
    });
  }

  const canAnalyze =
    resume.trim().length > 50 && jobDescription.trim().length > 20;
  const inputsLocked = phase !== "input" && phase !== "analyzed";

  return (
    <PageShell
      title="Tailor a résumé you can defend in the interview"
      intro={
        <>
          Paste your LaTeX résumé and the job description. You get a fit
          assessment first, then a rewrite that only leans on skills you
          actually have.
        </>
      }
      footer={<BackendFooter label="Resuitme" />}
    >
      {error && (
        <Notice tone="bad">
          <strong className="font-medium text-type-strong">
            Something went wrong.
          </strong>{" "}
          {error}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <label
              htmlFor="resume-source"
              className="text-sm font-medium text-type-strong"
            >
              Your résumé
            </label>
            {profile?.baseResumeLatex && (
              <button
                onClick={loadBaseResume}
                disabled={inputsLocked}
                className="shrink-0 text-sm text-marigold underline underline-offset-4 hover:text-marigold-deep disabled:no-underline disabled:opacity-40"
              >
                Use my saved one
              </button>
            )}
          </div>
          <textarea
            id="resume-source"
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            disabled={inputsLocked}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={`\\documentclass{article}\n\\begin{document}\n...\n\\end{document}`}
            className="h-52 resize-y border border-type-strong/15 bg-stock-shade/50 px-3.5 py-3 font-mono text-[0.8125rem] leading-relaxed text-type-strong transition-colors placeholder:text-type-faint focus-visible:border-marigold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-marigold/40 disabled:opacity-60 sm:h-64 lg:h-[26rem]"
          />
          <p className="mt-1.5 text-xs tabular-nums text-type-faint">
            {resume.length.toLocaleString()} characters
          </p>
        </div>

        <div className="flex flex-col">
          <label
            htmlFor="job-description"
            className="mb-2 text-sm font-medium text-type-strong"
          >
            The job description
          </label>
          <textarea
            id="job-description"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={inputsLocked}
            placeholder="Paste the whole posting — requirements included."
            className="h-52 resize-y border border-type-strong/15 bg-stock-shade/50 px-3.5 py-3 text-sm leading-relaxed text-type-strong transition-colors placeholder:text-type-faint focus-visible:border-marigold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-marigold/40 disabled:opacity-60 sm:h-64 lg:h-[26rem]"
          />
          <p className="mt-1.5 text-xs tabular-nums text-type-faint">
            {jobDescription.length.toLocaleString()} characters
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={analyzeOriginal}
          disabled={!canAnalyze || busy !== null}
          className="w-full bg-type-strong px-6 py-3 text-sm font-medium text-stock transition-colors hover:bg-marigold-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marigold disabled:cursor-not-allowed disabled:bg-type-muted disabled:text-stock sm:w-auto"
        >
          {busy === "analyze" ? "Reading it…" : "Check the fit"}
        </button>
        {phase !== "input" && (
          <button
            onClick={reset}
            disabled={busy !== null}
            className="w-full border border-type-strong/20 px-5 py-3 text-sm text-type-body transition-colors hover:bg-stock-shade focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marigold disabled:opacity-40 sm:w-auto"
          >
            Start over
          </button>
        )}
        {!canAnalyze && (
          <Note className="text-type-faint">
            Both fields are needed before anything can be checked.
          </Note>
        )}
      </div>

      {/* Original analysis */}
      {originalAnalysis && (
        <Region
          title="How it reads against this job"
          aside={<ScorePill score={originalAnalysis.score} />}
        >
          <div className="mb-6">
            <FitVerdictNotice fit={originalAnalysis.fit} accent="marigold" />
          </div>

          <AnalysisCard analysis={originalAnalysis} accent="marigold" />

          {(phase === "analyzed" || phase === "honesty") && (
            <div className="mt-6">
              {originalAnalysis.keyword_coverage.missing.length > 0 ? (
                <HonestyPanel
                  missing={originalAnalysis.keyword_coverage.missing}
                  honest={honest}
                  setVerdict={setVerdict}
                  setAllVerdicts={setAllVerdicts}
                  honestNotes={honestNotes}
                  setHonestNotes={setHonestNotes}
                  onContinue={tailor}
                  busy={busy !== null}
                  ctaLabel="Tailor the résumé"
                  sourceNoun="your résumé doesn't mention"
                  outputNoun="tailored version"
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={tailor}
                    disabled={busy !== null}
                    className="w-full rounded-md bg-sage-500 px-6 py-3 text-sm font-semibold text-ink transition hover:bg-sage-400 disabled:opacity-40 sm:w-auto"
                  >
                    Tailor my résumé to this job
                  </button>
                  <span className="text-sm text-type-muted">
                    No keyword gaps — straightforward tailor.
                  </span>
                </div>
              )}
            </div>
          )}
        </Region>
      )}

      {/* Tailoring state */}
      {phase === "tailoring" && (
        <Region className="border-t-type-strong/12">
          <div
            role="status"
            className="flex items-baseline gap-3 font-display text-lg text-type-strong sm:text-xl"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 translate-y-[-0.15em] animate-pulse rounded-full bg-marigold"
            />
            {busy === "tailor"
              ? "Tailoring your résumé…"
              : busy === "render"
                ? "Compiling to PDF to check the real page count…"
                : busy === "verify"
                  ? "Planning cuts to fit one page…"
                  : busy === "trim"
                    ? "Trimming to fit one page…"
                    : "Re-analyzing the tailored version…"}
          </div>
          <Note className="mt-2 text-type-faint">
            Several model passes run in sequence. Expect 30–60 seconds on a
            hosted model, longer on a local one.
          </Note>
        </Region>
      )}

      {/* Tailored result */}
      {phase === "tailored" && tailoredAnalysis && (
        <>
          <Region className="border-t-type-strong/12">
            <h2 className="mb-5 flex flex-wrap items-center gap-3 font-display text-2xl font-medium sm:text-3xl md:gap-4">
              Tailored rating
              <ScorePill score={tailoredAnalysis.score} />
              {originalAnalysis && (
                <span className="text-sm font-normal text-type-muted">
                  was{" "}
                  <span className="text-type-body">
                    {originalAnalysis.score}
                  </span>
                  {tailoredAnalysis.score > originalAnalysis.score && (
                    <span className="ml-2 text-sage-ink">
                      +{tailoredAnalysis.score - originalAnalysis.score}
                    </span>
                  )}
                  {tailoredAnalysis.score < originalAnalysis.score && (
                    <span className="ml-2 text-rust">
                      {tailoredAnalysis.score - originalAnalysis.score}
                    </span>
                  )}
                </span>
              )}
            </h2>
            <AnalysisCard analysis={tailoredAnalysis} accent="marigold" />
          </Region>

          <LatexResult
            title="Tailored LaTeX"
            latex={tailoredLatex}
            filename="resume-tailored.tex"
            overleafName="Tailored Resume (Resuitme)"
            budgetInfo={budgetInfo}
            ats={ats}
            atsFindings={atsFindings}
            accent="marigold"
            hint={
              <>
                Tap <span className="text-marigold">Overleaf</span> for an
                instant PDF preview in a new tab — Overleaf renders LaTeX with
                full package support.
              </>
            }
          />
        </>
      )}
    </PageShell>
  );
}
