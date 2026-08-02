"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Analysis, BudgetInfo } from "@/lib/types";
import { loadProfile, profileToText, type Profile } from "@/lib/profile";
import {
  computeBuildBudget,
  isWithinBudget,
  MAX_TRIM_PASSES,
  visibleChars,
} from "@/lib/latex";
import { checkPageCount, cutTarget } from "@/lib/render";
import { getTemplate } from "@/lib/templates";
import SiteNav from "@/components/SiteNav";
import BackendFooter from "@/components/BackendFooter";
import { AnalysisCard, ScorePill } from "@/components/Analysis";
import HonestyPanel, { type HonestVerdict } from "@/components/HonestyPanel";
import LatexResult from "@/components/LatexResult";

type Phase = "input" | "analyzed" | "honesty" | "building" | "built";

function getProfileAsResumeText(p: Profile): string {
  if (p.baseCvLatex?.trim()) return p.baseCvLatex;
  if (p.parsed) return profileToText(p.parsed);
  if (p.additionalSkills?.trim()) return p.additionalSkills;
  return "";
}

export default function BuildPage() {
  const [jobDescription, setJobDescription] = useState("");

  const [phase, setPhase] = useState<Phase>("input");
  const [busy, setBusy] = useState<
    null | "analyze" | "build" | "render" | "verify" | "trim" | "reanalyze"
  >(null);
  const [error, setError] = useState<string | null>(null);

  const [profileFitAnalysis, setProfileFitAnalysis] = useState<Analysis | null>(
    null,
  );
  const [builtLatex, setBuiltLatex] = useState<string>("");
  const [builtAnalysis, setBuiltAnalysis] = useState<Analysis | null>(null);

  const [budgetInfo, setBudgetInfo] = useState<BudgetInfo | null>(null);

  const [honest, setHonest] = useState<Record<string, HonestVerdict>>({});
  const [honestNotes, setHonestNotes] = useState("");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setProfile(loadProfile());
    setHydrated(true);
  }, []);

  const hasProfileContent = !!(
    profile?.parsed ||
    profile?.baseCvLatex?.trim() ||
    profile?.additionalSkills?.trim()
  );
  const usingBuiltinTemplate = !profile?.baseResumeLatex?.trim();
  const template = getTemplate();

  async function analyzeFit() {
    if (!profile || !hasProfileContent) return;
    setError(null);
    setBusy("analyze");
    try {
      const resumeText = getProfileAsResumeText(profile);
      if (!resumeText.trim()) {
        throw new Error("Your profile has no content to analyze.");
      }
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resume: resumeText,
          jobDescription,
          inputKind: "profile",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setProfileFitAnalysis(data.analysis);
      setBuiltAnalysis(null);
      setBuiltLatex("");

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

  async function build() {
    if (!profileFitAnalysis || !profile) return;
    setError(null);
    setBudgetInfo(null);
    setBusy("build");
    setPhase("building");
    try {
      const { budget, originalChars, capped } = computeBuildBudget(
        profile.baseResumeLatex,
      );

      const callBuild = (cuts?: string[]) =>
        fetch("/api/build", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jobDescription,
            // Send only when user has a saved layout — let the backend
            // fall back to the built-in template otherwise.
            template: profile.baseResumeLatex?.trim() || undefined,
            profileContext: {
              parsedProfile: profile.parsed,
              baseCvLatex: profile.baseCvLatex,
              additionalSkills: profile.additionalSkills,
            },
            analysis: profileFitAnalysis,
            honest: {
              perKeyword: honest,
              notes: honestNotes.trim() || undefined,
            },
            budget,
            cuts,
          }),
        });

      // Multi-pass build + render/verify/trim loop. The REAL page count from a
      // compile is authoritative for "fits one page"; the visible-char budget
      // is only a fallback (when rendering is unavailable) and a cut-sizing aid.
      let built = "";
      let chars = 0;
      let iterations = 0;
      let allCutsApplied: string[] = [];
      let currentCuts: string[] | undefined = undefined;
      let pages: number | null = null;
      let fits = false;

      while (iterations < MAX_TRIM_PASSES) {
        setBusy(iterations === 0 ? "build" : "trim");
        const res = await callBuild(currentCuts);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error ??
              (iterations === 0 ? "Build failed" : "Trim pass failed"),
          );
        }
        built = data.latex as string;
        chars = visibleChars(built);
        iterations += 1;

        // Authoritative check: compile and count real pages.
        setBusy("render");
        const check = await checkPageCount(built);
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
            latex: built,
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
          // Verifier had nothing useful — surface as-is.
          break;
        }
        currentCuts = verifyData.suggestedCuts as string[];
        allCutsApplied = [...allCutsApplied, ...currentCuts];
      }

      setBuiltLatex(built);
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

      // Analyze the built résumé against the JD for a final score.
      setBusy("reanalyze");
      const res2 = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume: built, jobDescription }),
      });
      const data2 = await res2.json();
      if (!res2.ok) throw new Error(data2.error ?? "Re-analysis failed");
      setBuiltAnalysis(data2.analysis);
      setPhase("built");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("honesty");
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setPhase("input");
    setProfileFitAnalysis(null);
    setBuiltAnalysis(null);
    setBuiltLatex("");
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

  const canAnalyze = hasProfileContent && jobDescription.trim().length > 20;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 px-safe pb-tabbar sm:px-6 md:py-12">
      <SiteNav />

      <header className="mb-10 max-w-3xl md:mb-14">
        <div
          className="eyebrow mb-4 animate-rise-in text-sage-400 md:mb-5"
          style={{ animationDelay: "60ms" }}
        >
          Build mode
        </div>
        <h1
          className="animate-rise-in font-display text-4xl font-medium leading-[1.02] tracking-tight sm:text-5xl md:text-7xl md:leading-[0.95]"
          style={{ animationDelay: "120ms" }}
        >
          Build a résumé,{" "}
          <span className="italic text-sage-400">from scratch.</span>
        </h1>
        <p
          className="mt-5 max-w-xl animate-rise-in text-base leading-relaxed text-paper/65 md:mt-6 md:text-lg"
          style={{ animationDelay: "220ms" }}
        >
          Paste a job post. Resuitme composes a one-page résumé from your full
          profile and CV — tailored to the role,{" "}
          <em className="font-medium not-italic text-paper/90">
            never invented
          </em>
          .
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      {/* Template + content pool */}
      {hydrated && (
        <section
          className="mb-6 animate-rise-in"
          style={{ animationDelay: "260ms" }}
        >
          <TemplateCard
            profile={profile}
            usingBuiltin={usingBuiltinTemplate}
            hasProfileContent={hasProfileContent}
            templateName={template.name}
            templateDescription={template.description}
          />
        </section>
      )}

      {/* JD input */}
      <section
        className="mb-6 animate-rise-in"
        style={{ animationDelay: "320ms" }}
      >
        <label className="eyebrow mb-2.5 block text-paper/55">
          01 — Job description
        </label>
        <textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          disabled={phase !== "input" && phase !== "analyzed"}
          placeholder="Paste the full job description here…"
          className="h-56 w-full resize-y rounded-md border border-paper/10 bg-ink-raised/60 px-4 py-3 text-sm leading-relaxed transition-colors placeholder:text-paper/25 focus:border-sage-500/60 focus:outline-none focus:ring-1 focus:ring-sage-500/30 disabled:opacity-60 sm:h-72"
        />
        <div className="mt-1.5 text-xs tabular-nums text-paper/40">
          {jobDescription.length.toLocaleString()} chars
        </div>
      </section>

      <div className="mb-12 flex flex-wrap items-center gap-3 md:mb-16">
        <button
          onClick={analyzeFit}
          disabled={!canAnalyze || busy !== null}
          className="w-full rounded-md bg-sage-500 px-6 py-3 text-sm font-semibold text-ink shadow-[0_2px_20px_-6px_rgba(116,160,94,0.7)] transition-all hover:bg-sage-400 hover:shadow-[0_4px_28px_-6px_rgba(116,160,94,0.9)] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {busy === "analyze" ? "Analyzing fit…" : "Analyze fit"}
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
            {!hasProfileContent
              ? "Build a profile first to use Build mode."
              : "Paste a job description to begin."}
          </span>
        )}
      </div>

      {/* Profile fit analysis */}
      {profileFitAnalysis && (
        <section className="mb-12 animate-rise-in md:mb-14">
          <h2 className="mb-5 flex flex-wrap items-center gap-3 font-display text-2xl font-medium sm:text-3xl md:gap-4">
            Your profile vs this job
            <ScorePill score={profileFitAnalysis.score} />
          </h2>
          <AnalysisCard analysis={profileFitAnalysis} accent="sage" />

          {(phase === "analyzed" || phase === "honesty") && (
            <div className="mt-6">
              {profileFitAnalysis.keyword_coverage.missing.length > 0 ? (
                <HonestyPanel
                  missing={profileFitAnalysis.keyword_coverage.missing}
                  honest={honest}
                  setVerdict={setVerdict}
                  setAllVerdicts={setAllVerdicts}
                  honestNotes={honestNotes}
                  setHonestNotes={setHonestNotes}
                  onContinue={build}
                  busy={busy !== null}
                  ctaLabel="Build the résumé honestly →"
                  sourceNoun="your profile doesn't cover"
                  outputNoun="built résumé"
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={build}
                    disabled={busy !== null}
                    className="w-full rounded-md bg-sage-500 px-6 py-3 text-sm font-semibold text-ink transition hover:bg-sage-400 disabled:opacity-40 sm:w-auto"
                  >
                    Build my résumé for this job →
                  </button>
                  <span className="font-display text-xs italic text-paper/40">
                    No keyword gaps — straight build.
                  </span>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Building state */}
      {phase === "building" && (
        <section className="mb-12 animate-fade-in rounded-md border border-sage-500/20 bg-ink-raised/40 p-6 text-center sm:p-10 md:mb-14">
          <div className="mb-5 flex justify-center gap-1.5" aria-hidden>
            <span className="h-2 w-2 animate-bounce rounded-full bg-sage-500 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-sage-500 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-sage-500" />
          </div>
          <div className="font-display text-lg text-paper/85 sm:text-xl">
            {busy === "build"
              ? "Building your résumé from profile…"
              : busy === "render"
                ? "Compiling to PDF to check the real page count…"
                : busy === "verify"
                  ? "Planning cuts to fit one page…"
                  : busy === "trim"
                    ? "Trimming to fit one page…"
                    : "Scoring the built résumé…"}
          </div>
          <div className="mt-2 text-xs text-paper/40">
            This runs several model passes — expect 30–60s on a hosted model,
            longer on a local one.
          </div>
        </section>
      )}

      {/* Built result */}
      {phase === "built" && builtAnalysis && (
        <>
          <section className="mb-12 animate-rise-in md:mb-14">
            <h2 className="mb-5 flex flex-wrap items-center gap-3 font-display text-2xl font-medium sm:text-3xl md:gap-4">
              Built résumé rating
              <ScorePill score={builtAnalysis.score} />
              {profileFitAnalysis && (
                <span className="text-sm font-normal text-paper/50">
                  your profile fit was{" "}
                  <span className="text-paper/70">
                    {profileFitAnalysis.score}
                  </span>
                  {builtAnalysis.score > profileFitAnalysis.score && (
                    <span className="ml-2 text-sage-400">
                      +{builtAnalysis.score - profileFitAnalysis.score}
                    </span>
                  )}
                  {builtAnalysis.score < profileFitAnalysis.score && (
                    <span className="ml-2 text-orange-300">
                      {builtAnalysis.score - profileFitAnalysis.score}
                    </span>
                  )}
                </span>
              )}
            </h2>
            <AnalysisCard analysis={builtAnalysis} accent="sage" />
          </section>

          <LatexResult
            title="Built LaTeX"
            latex={builtLatex}
            filename="resume-built.tex"
            overleafName="Built Resume (Resuitme)"
            budgetInfo={budgetInfo}
            accent="sage"
            hint={
              <>
                Tap <span className="text-sage-300">Overleaf</span> for an
                instant PDF preview in a new tab.
              </>
            }
          />
        </>
      )}

      <BackendFooter label="Resuitme — build mode" />
    </main>
  );
}

function TemplateCard({
  profile,
  usingBuiltin,
  hasProfileContent,
  templateName,
  templateDescription,
}: {
  profile: Profile | null;
  usingBuiltin: boolean;
  hasProfileContent: boolean;
  templateName: string;
  templateDescription: string;
}) {
  const hasParsed = !!profile?.parsed;
  const hasCv = !!profile?.baseCvLatex?.trim();
  const hasNotes = !!profile?.additionalSkills?.trim();
  const counts = hasParsed
    ? {
        exp: profile!.parsed!.experience.length,
        proj: profile!.parsed!.projects.length,
        skills: profile!.parsed!.skills.flat.length,
      }
    : null;

  if (!hasProfileContent) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-orange-500/30 bg-orange-500/[0.04] p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="eyebrow mb-1.5 text-orange-300">
            00 — No content pool
          </div>
          <div className="font-display text-base text-orange-100">
            Build a profile to use Build mode.
          </div>
          <div className="mt-1.5 max-w-prose text-xs leading-relaxed text-paper/55">
            Build mode composes a résumé entirely from your profile — parsed
            entries, CV, and skill notes. Add anything to your profile to unlock
            this mode.
          </div>
        </div>
        <Link
          href="/profile"
          className="shrink-0 border-b border-orange-300/30 pb-0.5 text-xs text-orange-200 hover:border-orange-200 hover:text-orange-100"
        >
          Set up profile →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-sage-500/25 bg-sage-500/[0.04] p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <div className="eyebrow mb-1.5 text-sage-400">
          00 — Template &amp; content pool
        </div>
        <div className="font-display text-base text-paper/90">
          {usingBuiltin ? (
            <>
              Using the built-in <span className="italic">{templateName}</span>{" "}
              template.
            </>
          ) : (
            <>Using your saved base résumé as the LaTeX template.</>
          )}
        </div>
        <div className="mt-1.5 max-w-prose text-xs leading-relaxed text-paper/55">
          {usingBuiltin ? (
            <>
              {templateDescription}{" "}
              <Link
                href="/profile"
                className="text-sage-300 underline underline-offset-2 hover:text-sage-200"
              >
                Save your own résumé LaTeX
              </Link>{" "}
              in your profile to use your layout instead.{" "}
            </>
          ) : (
            <>Preamble, packages, and macros preserved. </>
          )}
          {hasParsed ? (
            <>
              Content pool —{" "}
              <span className="tabular-nums text-paper/80">{counts!.exp}</span>{" "}
              experiences,{" "}
              <span className="tabular-nums text-paper/80">{counts!.proj}</span>{" "}
              projects,{" "}
              <span className="tabular-nums text-paper/80">
                {counts!.skills}
              </span>{" "}
              skills available.
            </>
          ) : hasCv ? (
            <>Content pool: your base CV LaTeX.</>
          ) : hasNotes ? (
            <>Content pool: your skills notes.</>
          ) : null}
        </div>
      </div>
      <Link
        href="/profile"
        className="shrink-0 border-b border-sage-500/30 pb-0.5 text-xs text-sage-300 hover:border-sage-400 hover:text-sage-200"
      >
        Edit profile →
      </Link>
    </div>
  );
}
