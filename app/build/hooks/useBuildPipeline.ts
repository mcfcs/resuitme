"use client";

// Build-mode pipeline: analyze profile fit → honesty pass → build → fit to one
// page → re-analyze the result.
//
// The fitting loop itself lives in lib/trim-loop.ts so it can be unit-tested
// without a browser, a model, or a LaTeX compiler; this hook only supplies the
// network calls and owns the React state.

import { useCallback, useEffect, useState } from "react";
import type { Analysis, BudgetInfo } from "@/lib/types";
import { loadProfile, profileToText, type Profile } from "@/lib/profile";
import { computeBuildBudget } from "@/lib/latex";
import { getTemplate, DEFAULT_TEMPLATE_ID } from "@/lib/templates";
import { checkPageCount, scanAts, type AtsScanResult } from "@/lib/render";
import { lintLatexForAts, type AtsFinding } from "@/lib/ats/source-lint";
import { runFitLoop } from "@/lib/trim-loop";
import type { HonestVerdict } from "@/components/HonestyPanel";

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

  const build = useCallback(async () => {
    if (!profileFitAnalysis || !profile) return;
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
          const data = await res.json();
          if (!res.ok) {
            throw new Error(
              data.error ?? (cuts ? "Trim pass failed" : "Build failed"),
            );
          }
          return data.latex as string;
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
  }, [
    profileFitAnalysis,
    profile,
    jobDescription,
    honest,
    honestNotes,
    templateId,
  ]);

  const reset = useCallback(() => {
    setPhase("input");
    setProfileFitAnalysis(null);
    setBuiltLatex("");
    setBuiltAnalysis(null);
    setBudgetInfo(null);
    setHonest({});
    setHonestNotes("");
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
  };
}
