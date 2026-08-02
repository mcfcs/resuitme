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
import { checkPageCount, cutTarget } from "@/lib/render";
import SiteNav from "@/components/SiteNav";
import BackendFooter from "@/components/BackendFooter";
import { AnalysisCard, ScorePill } from "@/components/Analysis";
import HonestyPanel, { type HonestVerdict } from "@/components/HonestyPanel";
import LatexResult from "@/components/LatexResult";

type Phase = "input" | "analyzed" | "honesty" | "tailoring" | "tailored";

export default function Home() {
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  const [phase, setPhase] = useState<Phase>("input");
  const [busy, setBusy] = useState<
    null | "analyze" | "tailor" | "render" | "verify" | "trim" | "reanalyze"
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
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 px-safe pb-tabbar sm:px-6 md:py-12">
      <SiteNav />

      <header className="mb-10 max-w-3xl md:mb-14">
        <div
          className="eyebrow mb-4 animate-rise-in text-marigold md:mb-5"
          style={{ animationDelay: "60ms" }}
        >
          Honest resume tailoring
        </div>
        <h1
          className="animate-rise-in font-display text-4xl font-medium leading-[1.02] tracking-tight sm:text-5xl md:text-7xl md:leading-[0.95]"
          style={{ animationDelay: "120ms" }}
        >
          Tailor your résumé,{" "}
          <span className="italic text-marigold">truthfully.</span>
        </h1>
        <p
          className="mt-5 max-w-xl animate-rise-in text-base leading-relaxed text-paper/65 md:mt-6 md:text-lg"
          style={{ animationDelay: "220ms" }}
        >
          Paste your LaTeX résumé and a job description. Get an honest rating,
          then a tailored rewrite that only emphasizes skills you{" "}
          <em className="font-medium not-italic text-paper/90">
            actually have
          </em>
          .
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      {/* Input panel */}
      <section
        className="mb-6 grid animate-rise-in gap-5 md:grid-cols-2"
        style={{ animationDelay: "320ms" }}
      >
        <div className="flex flex-col">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <label className="eyebrow text-paper/55">
              01 — Résumé · LaTeX source
            </label>
            {profile?.baseResumeLatex && (
              <button
                onClick={loadBaseResume}
                disabled={inputsLocked}
                className="shrink-0 text-xs text-sage-300 underline underline-offset-4 hover:text-sage-200 disabled:no-underline disabled:opacity-40"
              >
                Use my base résumé
              </button>
            )}
          </div>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            disabled={inputsLocked}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={`\\documentclass{article}\n\\begin{document}\n...\n\\end{document}`}
            className="h-56 resize-y rounded-md border border-paper/10 bg-ink-raised/60 px-4 py-3 font-mono text-sm transition-colors placeholder:text-paper/25 focus:border-marigold/60 focus:outline-none focus:ring-1 focus:ring-marigold/30 disabled:opacity-60 sm:h-72 md:h-96"
          />
          <div className="mt-1.5 text-xs tabular-nums text-paper/40">
            {resume.length.toLocaleString()} chars
          </div>
        </div>

        <div className="flex flex-col">
          <label className="eyebrow mb-2.5 text-paper/55">
            02 — Job description
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={inputsLocked}
            placeholder="Paste the full job description here…"
            className="h-56 resize-y rounded-md border border-paper/10 bg-ink-raised/60 px-4 py-3 text-sm leading-relaxed transition-colors placeholder:text-paper/25 focus:border-marigold/60 focus:outline-none focus:ring-1 focus:ring-marigold/30 disabled:opacity-60 sm:h-72 md:h-96"
          />
          <div className="mt-1.5 text-xs tabular-nums text-paper/40">
            {jobDescription.length.toLocaleString()} chars
          </div>
        </div>
      </section>

      <div className="mb-12 flex flex-wrap items-center gap-3 md:mb-16">
        <button
          onClick={analyzeOriginal}
          disabled={!canAnalyze || busy !== null}
          className="w-full rounded-md bg-marigold px-6 py-3 text-sm font-semibold text-ink shadow-[0_2px_20px_-6px_rgba(232,168,56,0.6)] transition-all hover:bg-marigold-deep hover:shadow-[0_4px_28px_-6px_rgba(232,168,56,0.8)] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {busy === "analyze" ? "Analyzing…" : "Analyze résumé"}
        </button>
        {phase !== "input" && (
          <button
            onClick={reset}
            disabled={busy !== null}
            className="w-full rounded-md border border-paper/15 px-5 py-3 text-sm text-paper/70 transition hover:border-paper/30 hover:bg-paper/5 disabled:opacity-40 sm:w-auto"
          >
            Start over
          </button>
        )}
        {!canAnalyze && (
          <span className="font-display text-xs italic text-paper/40">
            Paste a résumé and a job description to begin.
          </span>
        )}
      </div>

      {/* Original analysis */}
      {originalAnalysis && (
        <section className="mb-12 animate-rise-in md:mb-14">
          <h2 className="mb-5 flex flex-wrap items-center gap-3 font-display text-2xl font-medium sm:text-3xl md:gap-4">
            Original rating
            <ScorePill score={originalAnalysis.score} />
          </h2>
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
                  ctaLabel="Tailor honestly →"
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
                    Tailor my résumé to this job →
                  </button>
                  <span className="font-display text-xs italic text-paper/40">
                    No keyword gaps — straightforward tailor.
                  </span>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Tailoring state */}
      {phase === "tailoring" && (
        <section className="mb-12 animate-fade-in rounded-md border border-marigold/20 bg-ink-raised/40 p-6 text-center sm:p-10 md:mb-14">
          <div className="mb-5 flex justify-center gap-1.5" aria-hidden>
            <span className="h-2 w-2 animate-bounce rounded-full bg-marigold [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-marigold [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-marigold" />
          </div>
          <div className="font-display text-lg text-paper/85 sm:text-xl">
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
          <div className="mt-2 text-xs text-paper/40">
            This runs several model passes — expect 30–60s on a hosted model,
            longer on a local one.
          </div>
        </section>
      )}

      {/* Tailored result */}
      {phase === "tailored" && tailoredAnalysis && (
        <>
          <section className="mb-12 animate-rise-in md:mb-14">
            <h2 className="mb-5 flex flex-wrap items-center gap-3 font-display text-2xl font-medium sm:text-3xl md:gap-4">
              Tailored rating
              <ScorePill score={tailoredAnalysis.score} />
              {originalAnalysis && (
                <span className="text-sm font-normal text-paper/50">
                  was{" "}
                  <span className="text-paper/70">
                    {originalAnalysis.score}
                  </span>
                  {tailoredAnalysis.score > originalAnalysis.score && (
                    <span className="ml-2 text-sage-400">
                      +{tailoredAnalysis.score - originalAnalysis.score}
                    </span>
                  )}
                  {tailoredAnalysis.score < originalAnalysis.score && (
                    <span className="ml-2 text-orange-300">
                      {tailoredAnalysis.score - originalAnalysis.score}
                    </span>
                  )}
                </span>
              )}
            </h2>
            <AnalysisCard analysis={tailoredAnalysis} accent="marigold" />
          </section>

          <LatexResult
            title="Tailored LaTeX"
            latex={tailoredLatex}
            filename="resume-tailored.tex"
            overleafName="Tailored Resume (Resuitme)"
            budgetInfo={budgetInfo}
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

      <BackendFooter label="Resuitme" />
    </main>
  );
}
