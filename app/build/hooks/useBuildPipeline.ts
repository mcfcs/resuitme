"use client";

// Build-mode pipeline: analyze profile fit → honesty pass → build → fit to one
// page → re-analyze the result.
//
// The fitting loop itself lives in lib/trim-loop.ts so it can be unit-tested
// without a browser, a model, or a LaTeX compiler; this hook only supplies the
// network calls and owns the React state.

import { useCallback, useEffect, useState } from "react";
import type { Analysis, BudgetInfo } from "@/lib/types";
import {
  loadProfile,
  metricsToText,
  profileToText,
  saveProfile,
  type Profile,
  type ProfileMetric,
} from "@/lib/profile";
import { computeBuildBudget } from "@/lib/latex";
import { getTemplate, DEFAULT_TEMPLATE_ID } from "@/lib/templates";
import { checkPageCount, scanAts, type AtsScanResult } from "@/lib/render";
import { lintLatexForAts, type AtsFinding } from "@/lib/ats/source-lint";
import { runFitLoop } from "@/lib/trim-loop";
import type { HonestVerdict } from "@/components/HonestyPanel";
import type { SoftenedClaim } from "@/lib/ats/claim-check";
import type { BuildResponse } from "@/app/api/build/route";
import {
  mergeMetrics,
  metricsFromAnswers,
  type MetricAnswer,
} from "@/lib/metrics";

export type Phase = "input" | "analyzed" | "honesty" | "building" | "built";

export type Busy =
  | null
  | "analyze"
  | "build"
  | "trim"
  | "render"
  | "verify"
  | "expand"
  | "ats"
  | "reanalyze";

/**
 * What the analyzer sees for a profile input. The CV is the fullest source of
 * truth; fall back to the merged profile, then to raw notes.
 */
export function getProfileAsResumeText(p: Profile): string {
  if (p.baseCvLatex?.trim()) return p.baseCvLatex;
  if (p.parsed) return profileToText(p.parsed);
  if (p.additionalSkills?.trim()) return p.additionalSkills;
  return "";
}

export function useBuildPipeline() {
  const [jobDescription, setJobDescription] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const [profileFitAnalysis, setProfileFitAnalysis] = useState<Analysis | null>(
    null,
  );
  const [builtLatex, setBuiltLatex] = useState<string>("");
  const [builtAnalysis, setBuiltAnalysis] = useState<Analysis | null>(null);
  const [budgetInfo, setBudgetInfo] = useState<BudgetInfo | null>(null);
  const [ats, setAts] = useState<AtsScanResult | null>(null);
  const [atsFindings, setAtsFindings] = useState<AtsFinding[]>([]);

  const [honest, setHonest] = useState<Record<string, HonestVerdict>>({});
  const [honestNotes, setHonestNotes] = useState("");

  // What the honesty gate took out of the accepted draft, and the candidate's
  // answers to the metrics panel about it.
  const [softened, setSoftened] = useState<SoftenedClaim[]>([]);
  const [metricAnswers, setMetricAnswers] = useState<
    Record<string, MetricAnswer>
  >({});
  const [saveMetricsToProfile, setSaveMetricsToProfile] = useState(true);

  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const p = loadProfile();
    setProfile(p);
    if (p?.templateId) setTemplateId(p.templateId);
    setHydrated(true);
  }, []);

  const hasProfileContent = !!(
    profile?.parsed ||
    profile?.baseCvLatex?.trim() ||
    profile?.additionalSkills?.trim()
  );

  const analyzeFit = useCallback(async () => {
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

      // Seed every missing keyword to "partial" so the honesty panel starts
      // from a neutral position rather than defaulting to "I have this".
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
  }, [profile, hasProfileContent, jobDescription]);

  /**
   * Build the résumé. `metrics` overrides the profile's saved metrics for
   * this build — the metrics panel passes the freshly merged list, because
   * React state would not have caught up yet.
   */
  const build = useCallback(
    async (opts?: { metrics?: ProfileMetric[] }) => {
      if (!profileFitAnalysis || !profile) return;
      const metrics = opts?.metrics ?? profile.metrics;
      setError(null);
      setBudgetInfo(null);
      setAts(null);
      setAtsFindings([]);
      setBusy("build");
      setPhase("building");
      try {
        const template = getTemplate(templateId);
        const { budget, originalChars, capped } = computeBuildBudget(
          profile.baseResumeLatex,
          template.targetChars,
        );

        // The fit loop accepts one of several drafts; the panel must show what
        // was softened in THAT draft, so each response is kept by its LaTeX.
        const softenedByLatex = new Map<string, SoftenedClaim[]>();

        const result = await runFitLoop(budget, {
          onPhase: setBusy,
          generate: async (cuts, additions) => {
            const res = await fetch("/api/build", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jobDescription,
                // Send only when user has a saved layout — let the backend
                // fall back to the built-in template otherwise.
                template: profile.baseResumeLatex?.trim() || undefined,
                templateId,
                profileContext: {
                  parsedProfile: profile.parsed,
                  baseCvLatex: profile.baseCvLatex,
                  additionalSkills: profile.additionalSkills,
                  metrics,
                },
                analysis: profileFitAnalysis,
                honest: {
                  perKeyword: honest,
                  notes: honestNotes.trim() || undefined,
                },
                budget,
                cuts,
                additions,
              }),
            });
            const data = (await res.json()) as BuildResponse & {
              error?: string;
            };
            if (!res.ok) {
              throw new Error(
                data.error ?? (cuts ? "Trim pass failed" : "Build failed"),
              );
            }
            softenedByLatex.set(data.latex, data.softened ?? []);
            return data.latex;
          },
          checkPages: (latex) => checkPageCount(latex),
          requestAdditions: async (latex, currentChars, shortBy) => {
            const res = await fetch("/api/tailor/expand", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                latex,
                jobDescription,
                // The ONLY legal source of additions. Quotes are verified
                // against this server-side.
                profilePool: [
                  profile.parsed ? JSON.stringify(profile.parsed) : "",
                  profile.baseCvLatex ?? "",
                  profile.additionalSkills ?? "",
                  metricsToText(metrics),
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                shortBy,
                budget,
                analysis: profileFitAnalysis,
                honest: {
                  perKeyword: honest,
                  notes: honestNotes.trim() || undefined,
                },
              }),
            });
            const data = await res.json();
            if (!res.ok || !Array.isArray(data.suggestedAdditions)) return [];
            return data.suggestedAdditions as string[];
          },
          requestCuts: async (latex, currentChars, overBy) => {
            const res = await fetch("/api/tailor/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                latex,
                jobDescription,
                budget,
                currentChars,
                overBy,
              }),
            });
            const data = await res.json();
            if (!res.ok || !Array.isArray(data.suggestedCuts)) return [];
            return data.suggestedCuts as string[];
          },
        });

        setBuiltLatex(result.latex);
        setSoftened(softenedByLatex.get(result.latex) ?? []);
        setMetricAnswers({});
        setBudgetInfo({
          budget,
          originalChars,
          resultChars: result.chars,
          capped,
          iterations: result.iterations,
          cutsApplied: result.cutsApplied,
          pages: result.pages,
          fits: result.fits,
        });

        // ATS pass on the FINAL draft only — the trim loop must not pay for
        // text extraction on every one of its passes.
        setAtsFindings(lintLatexForAts(result.latex));
        setBusy("ats");
        setAts(await scanAts(result.latex));

        // Analyze the built résumé against the JD for a final score.
        setBusy("reanalyze");
        const res2 = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resume: result.latex, jobDescription }),
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
    },
    [
      profileFitAnalysis,
      profile,
      jobDescription,
      honest,
      honestNotes,
      templateId,
    ],
  );

  const setMetricAnswer = useCallback((key: string, a: MetricAnswer) => {
    setMetricAnswers((prev) => ({ ...prev, [key]: a }));
  }, []);

  /**
   * Turn the panel's answers into the candidate's own metrics, persist them
   * when asked, and rebuild once with them in the pool. A confirmed metric is
   * grounded by assertion, so the rebuilt draft passes the gate on its own
   * merits rather than by exemption.
   */
  const applyMetrics = useCallback(async () => {
    if (!profile) return;
    const added = metricsFromAnswers(softened, metricAnswers);
    if (!added.length) return;
    const merged = mergeMetrics(profile.metrics, added);
    if (saveMetricsToProfile) {
      const next = { ...profile, metrics: merged };
      saveProfile(next);
      setProfile(next);
    }
    await build({ metrics: merged });
  }, [profile, softened, metricAnswers, saveMetricsToProfile, build]);

  const reset = useCallback(() => {
    setPhase("input");
    setProfileFitAnalysis(null);
    setBuiltLatex("");
    setBuiltAnalysis(null);
    setBudgetInfo(null);
    setHonest({});
    setHonestNotes("");
    setSoftened([]);
    setMetricAnswers({});
    setError(null);
  }, []);

  const setVerdict = useCallback((keyword: string, v: HonestVerdict) => {
    setHonest((h) => ({ ...h, [keyword]: v }));
  }, []);

  const setAllVerdicts = useCallback((v: HonestVerdict) => {
    setHonest((prev) => {
      const next: Record<string, HonestVerdict> = {};
      for (const k of Object.keys(prev)) next[k] = v;
      return next;
    });
  }, []);

  const canAnalyze = hasProfileContent && jobDescription.trim().length > 20;

  return {
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
    templateId,
    setTemplateId,
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
  };
}
