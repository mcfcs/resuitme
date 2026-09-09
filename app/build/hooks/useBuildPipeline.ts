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
import { checkPageCount } from "@/lib/render";
import { runTrimLoop } from "@/lib/trim-loop";
import type { HonestVerdict } from "@/components/HonestyPanel";

export type Phase = "input" | "analyzed" | "honesty" | "building" | "built";

export type Busy =
  null | "analyze" | "build" | "trim" | "render" | "verify" | "reanalyze";

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
    setBusy("build");
    setPhase("building");
    try {
      const { budget, originalChars, capped } = computeBuildBudget(
        profile.baseResumeLatex,
      );

      const result = await runTrimLoop(budget, {
        onPhase: setBusy,
        generate: async (cuts) => {
          const res = await fetch("/api/build", {
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
          const data = await res.json();
          if (!res.ok) {
            throw new Error(
              data.error ?? (cuts ? "Trim pass failed" : "Build failed"),
            );
          }
          return data.latex as string;
        },
        checkPages: (latex) => checkPageCount(latex),
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
  }, [profileFitAnalysis, profile, jobDescription, honest, honestNotes]);

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
  };
}
