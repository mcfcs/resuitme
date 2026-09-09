"use client";

// Build mode — compose a résumé from scratch out of the saved profile and CV,
// targeted at one job description.
//
// Composition only: the pipeline (analyze → honesty → build → fit → re-analyze)
// lives in app/build/hooks/useBuildPipeline.ts, and the one-page fitting loop
// inside it is lib/trim-loop.ts.

import { getTemplate } from "@/lib/templates";
import SiteNav from "@/components/SiteNav";
import BackendFooter from "@/components/BackendFooter";
import { AnalysisCard, ScorePill } from "@/components/Analysis";
import HonestyPanel from "@/components/HonestyPanel";
import LatexResult from "@/components/LatexResult";
import TemplateCard from "@/components/build/TemplateCard";
import { useBuildPipeline } from "@/app/build/hooks/useBuildPipeline";

export default function BuildPage() {
  const {
    jobDescription,
    setJobDescription,
    phase,
    setPhase,
    busy,
    error,
    profileFitAnalysis,
    builtLatex,
    builtAnalysis,
    budgetInfo,
    ats,
    atsFindings,
    honest,
    honestNotes,
    setHonestNotes,
    profile,
    hydrated,
    hasProfileContent,
    analyzeFit,
    build,
    reset,
    setVerdict,
    setAllVerdicts,
    canAnalyze,
  } = useBuildPipeline();

  const usingBuiltinTemplate = !profile?.baseResumeLatex?.trim();
  const template = getTemplate();

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
                    : busy === "ats"
                      ? "Checking what a résumé parser reads…"
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
            ats={ats}
            atsFindings={atsFindings}
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
