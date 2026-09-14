"use client";

// Build mode — compose a résumé from scratch out of the saved profile and CV,
// targeted at one job description.
//
// Composition only: the pipeline (analyze → honesty → build → fit → re-analyze)
// lives in app/build/hooks/useBuildPipeline.ts, and the one-page fitting loop
// inside it is lib/trim-loop.ts.

import { getTemplate } from "@/lib/templates";
import { saveProfile } from "@/lib/profile";
import PageShell from "@/components/PageShell";
import { Region, Note, Notice } from "@/components/Sheet";
import BackendFooter from "@/components/BackendFooter";
import { AnalysisCard, ScorePill } from "@/components/Analysis";
import FitVerdictNotice from "@/components/FitVerdict";
import HonestyPanel from "@/components/HonestyPanel";
import MetricsPanel from "@/components/MetricsPanel";
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
    templateId,
    setTemplateId,
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
    softened,
    metricAnswers,
    setMetricAnswer,
    saveMetricsToProfile,
    setSaveMetricsToProfile,
    applyMetrics,
  } = useBuildPipeline();

  const usingBuiltinTemplate = !profile?.baseResumeLatex?.trim();
  const template = getTemplate(templateId);

  // Persist the layout choice alongside the profile so it survives a reload.
  function selectTemplate(id: string) {
    setTemplateId(id);
    if (profile) saveProfile({ ...profile, templateId: id });
  }

  return (
    <PageShell
      title="Compose a résumé from everything you have"
      accent="sage"
      intro={
        <>
          Paste a job post. Resuitme picks from your saved profile and CV to
          fill one page — selecting and reframing what you have, never inventing
          what you don&apos;t.
        </>
      }
      footer={<BackendFooter label="Resuitme — build mode" />}
    >
      {error && (
        <Notice tone="bad">
          <strong className="font-medium text-type-strong">
            Something went wrong.
          </strong>{" "}
          {error}
        </Notice>
      )}

      {hydrated && (
        <TemplateCard
          profile={profile}
          usingBuiltin={usingBuiltinTemplate}
          hasProfileContent={hasProfileContent}
          templateName={template.name}
          templateDescription={template.description}
          templateId={templateId}
          onSelectTemplate={selectTemplate}
        />
      )}

      <div>
        <label
          htmlFor="build-jd"
          className="mb-2 block text-sm font-medium text-type-strong"
        >
          The job description
        </label>
        <textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          disabled={phase !== "input" && phase !== "analyzed"}
          placeholder="Paste the full job description here…"
          id="build-jd"
          className="h-52 w-full resize-y border border-type-strong/15 bg-stock-shade/50 px-3.5 py-3 text-sm leading-relaxed text-type-strong transition-colors placeholder:text-type-faint focus-visible:border-sage-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sage-ink/40 disabled:opacity-60 sm:h-64 lg:h-72"
        />
        <p className="mt-1.5 text-xs tabular-nums text-type-faint">
          {jobDescription.length.toLocaleString()} characters
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={analyzeFit}
          disabled={!canAnalyze || busy !== null}
          className="w-full bg-type-strong px-6 py-3 text-sm font-medium text-stock transition-colors hover:bg-sage-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-ink disabled:cursor-not-allowed disabled:bg-type-muted disabled:text-stock sm:w-auto"
        >
          {busy === "analyze" ? "Analyzing fit…" : "Analyze fit"}
        </button>
        {phase !== "input" && (
          <button
            onClick={reset}
            disabled={busy !== null}
            className="w-full rounded-md border border-paper/15 px-5 py-3 text-sm text-type-body transition hover:border-paper/30 hover:bg-paper/5 disabled:opacity-40 sm:w-auto"
          >
            Start over
          </button>
        )}
        {!canAnalyze && (
          <span className="text-sm text-type-muted">
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
          <div className="mb-6">
            <FitVerdictNotice fit={profileFitAnalysis.fit} accent="sage" />
          </div>

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
                  onContinue={() => build()}
                  busy={busy !== null}
                  ctaLabel="Build the résumé"
                  sourceNoun="your profile doesn't cover"
                  outputNoun="built résumé"
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => build()}
                    disabled={busy !== null}
                    className="w-full rounded-md bg-sage-ink px-6 py-3 text-sm font-semibold text-ink transition hover:bg-sage-ink disabled:opacity-40 sm:w-auto"
                  >
                    Build my résumé for this job
                  </button>
                  <span className="text-sm text-type-muted">
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
        <section className="mb-12 animate-fade-in rounded-md border border-sage-ink/20 bg-ink-raised/40 p-6 text-center sm:p-10 md:mb-14">
          <div className="mb-5 flex justify-center gap-1.5" aria-hidden>
            <span className="h-2 w-2 animate-bounce rounded-full bg-sage-ink [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-sage-ink [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-sage-ink" />
          </div>
          <div className="font-display text-lg text-type-strong sm:text-xl">
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
          <div className="mt-2 text-xs text-type-muted">
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
                <span className="text-sm font-normal text-type-muted">
                  your profile fit was{" "}
                  <span className="text-type-body">
                    {profileFitAnalysis.score}
                  </span>
                  {builtAnalysis.score > profileFitAnalysis.score && (
                    <span className="ml-2 text-sage-ink">
                      +{builtAnalysis.score - profileFitAnalysis.score}
                    </span>
                  )}
                  {builtAnalysis.score < profileFitAnalysis.score && (
                    <span className="ml-2 text-rust">
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
                Tap <span className="text-sage-ink">Overleaf</span> for an
                instant PDF preview in a new tab.
              </>
            }
          />

          {/* After the résumé, never before it: the résumé is finished, and
              this is opt-in enrichment in the candidate's own words. */}
          {softened.length > 0 && (
            <MetricsPanel
              softened={softened}
              answers={metricAnswers}
              setAnswer={setMetricAnswer}
              saveToProfile={saveMetricsToProfile}
              setSaveToProfile={setSaveMetricsToProfile}
              onApply={applyMetrics}
              busy={busy !== null}
            />
          )}
        </>
      )}
    </PageShell>
  );
}
