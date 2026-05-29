"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Analysis, MustIncludePick } from "@/lib/types";
import {
  loadProfile,
  profileToText,
  type Profile,
} from "@/lib/profile";
import {
  computeOnePageBudget,
  isWithinBudget,
  MAX_TRIM_PASSES,
  visibleChars,
} from "@/lib/latex";
import { getTemplate } from "@/lib/templates";

type Phase = "input" | "analyzed" | "honesty" | "building" | "built";

type HonestVerdict = "have" | "partial" | "none";

type BudgetInfo = {
  budget: number;
  originalChars: number;
  builtChars: number;
  capped: boolean;
  iterations: number;
  cutsApplied: string[];
  fits: boolean;
};

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
    null | "analyze" | "build" | "verify" | "trim" | "reanalyze"
  >(null);
  const [error, setError] = useState<string | null>(null);

  const [profileFitAnalysis, setProfileFitAnalysis] =
    useState<Analysis | null>(null);
  const [builtLatex, setBuiltLatex] = useState<string>("");
  const [builtAnalysis, setBuiltAnalysis] = useState<Analysis | null>(null);

  const [copied, setCopied] = useState(false);
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
      const templateLatex = profile.baseResumeLatex?.trim() || template.latex;
      const { budget, originalChars, capped } =
        computeOnePageBudget(templateLatex);

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

      // Multi-pass build + verify/trim loop. Stop early when under budget,
      // otherwise keep applying fresh cuts until we hit MAX_TRIM_PASSES.
      let built = "";
      let chars = 0;
      let iterations = 0;
      let allCutsApplied: string[] = [];
      let currentCuts: string[] | undefined = undefined;

      while (iterations < MAX_TRIM_PASSES) {
        setBusy(iterations === 0 ? "build" : "trim");
        const res = await callBuild(currentCuts);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error ?? (iterations === 0 ? "Build failed" : "Trim pass failed"),
          );
        }
        built = data.latex as string;
        chars = visibleChars(built);
        iterations += 1;

        // Under budget — done.
        if (chars <= budget) break;
        // Out of passes — surface what we have.
        if (iterations >= MAX_TRIM_PASSES) break;
        // Borderline overshoot (within tolerance) — don't burn another trim pass.
        if (isWithinBudget(chars, budget, 0.005)) break;

        // Otherwise ask the verifier for fresh cuts against THIS latest LaTeX.
        setBusy("verify");
        const verifyRes = await fetch("/api/tailor/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            latex: built,
            jobDescription,
            budget,
            currentChars: chars,
            overBy: chars - budget,
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
        builtChars: chars,
        capped,
        iterations,
        cutsApplied: allCutsApplied,
        // Strict: must be under budget (no tolerance) to claim "fits".
        fits: chars <= budget,
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

  async function copyLatex() {
    await navigator.clipboard.writeText(builtLatex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadLatex() {
    const blob = new Blob([builtLatex], { type: "text/x-tex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume-built.tex";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function openInOverleaf(latex: string) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "https://www.overleaf.com/docs";
    form.target = "_blank";
    form.rel = "noopener";
    const snip = document.createElement("textarea");
    snip.name = "snip";
    snip.value = latex;
    form.appendChild(snip);
    const name = document.createElement("input");
    name.type = "hidden";
    name.name = "snip_name";
    name.value = "Built Resume (Resuitme)";
    form.appendChild(name);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
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

  const canAnalyze =
    hasProfileContent && jobDescription.trim().length > 20;

  return (
    <main className="min-h-screen px-6 py-8 md:py-12 max-w-6xl mx-auto">
      <nav className="mb-12 flex items-center justify-between animate-fade-in">
        <Link href="/" className="group flex items-baseline gap-0.5">
          <span className="font-display text-2xl font-semibold tracking-tight">
            Resuitme
          </span>
          <span className="font-display italic text-2xl text-marigold leading-none">
            .
          </span>
        </Link>
        <div className="flex items-center gap-5">
          <Link
            href="/"
            className="eyebrow text-paper/60 hover:text-marigold border-b border-transparent hover:border-marigold pb-1 transition-colors"
          >
            Tailor mode
          </Link>
          <Link
            href="/profile"
            className="eyebrow text-paper/60 hover:text-marigold border-b border-paper/15 hover:border-marigold pb-1 transition-colors"
          >
            {profile?.updatedAt ? "Your profile →" : "Set up profile →"}
          </Link>
        </div>
      </nav>

      <header className="mb-14 max-w-3xl">
        <div
          className="eyebrow text-sage-400 mb-5 animate-rise-in"
          style={{ animationDelay: "60ms" }}
        >
          Build mode
        </div>
        <h1
          className="font-display text-5xl md:text-7xl font-medium leading-[0.95] tracking-tight animate-rise-in"
          style={{ animationDelay: "120ms" }}
        >
          Build a résumé,{" "}
          <span className="italic text-sage-400">from scratch.</span>
        </h1>
        <p
          className="mt-6 text-lg text-paper/65 leading-relaxed max-w-xl animate-rise-in"
          style={{ animationDelay: "220ms" }}
        >
          Paste a job post. Resuitme composes a one-page résumé from your full
          profile and CV — tailored to the role,{" "}
          <em className="text-paper/90 not-italic font-medium">never invented</em>.
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
        <label className="eyebrow text-paper/55 mb-2.5 block">
          01 — Job description
        </label>
        <textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          disabled={phase !== "input" && phase !== "analyzed"}
          placeholder="Paste the full job description here…"
          className="w-full text-sm leading-relaxed bg-ink-raised/60 border border-paper/10 rounded-md px-4 py-3 h-72 resize-y focus:outline-none focus:border-sage-500/60 focus:ring-1 focus:ring-sage-500/30 disabled:opacity-60 transition-colors placeholder:text-paper/25"
        />
        <div className="mt-1.5 text-xs text-paper/40 tabular-nums">
          {jobDescription.length.toLocaleString()} chars
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 mb-16">
        <button
          onClick={analyzeFit}
          disabled={!canAnalyze || busy !== null}
          className="group px-6 py-3 rounded-md bg-sage-500 text-ink font-semibold text-sm hover:bg-sage-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_2px_20px_-6px_rgba(116,160,94,0.7)] hover:shadow-[0_4px_28px_-6px_rgba(116,160,94,0.9)]"
        >
          {busy === "analyze" ? "Analyzing fit…" : "Analyze fit"}
        </button>
        {phase !== "input" && (
          <button
            onClick={reset}
            disabled={busy !== null}
            className="px-5 py-3 rounded-md border border-paper/15 text-sm text-paper/70 hover:bg-paper/5 hover:border-paper/30 disabled:opacity-40 transition"
          >
            Start over
          </button>
        )}
        {!canAnalyze && (
          <span className="text-xs text-paper/40 italic font-display">
            {!hasProfileContent
              ? "Build a profile first to use Build mode."
              : "Paste a job description to begin."}
          </span>
        )}
      </div>

      {/* Profile fit analysis */}
      {profileFitAnalysis && (
        <section className="mb-14 animate-rise-in">
          <h2 className="font-display text-3xl font-medium mb-5 flex items-center gap-4 flex-wrap">
            Your profile vs this job
            <ScorePill score={profileFitAnalysis.score} />
          </h2>
          <AnalysisCard analysis={profileFitAnalysis} />

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
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={build}
                    disabled={busy !== null}
                    className="px-6 py-3 rounded-md bg-sage-500 text-ink font-semibold text-sm hover:bg-sage-400 disabled:opacity-40 transition"
                  >
                    Build my résumé for this job →
                  </button>
                  <span className="text-xs text-paper/40 italic font-display">
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
        <section className="mb-14 rounded-md border border-sage-500/20 bg-ink-raised/40 p-10 text-center animate-fade-in">
          <div className="flex justify-center gap-1.5 mb-5" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-sage-500 animate-bounce [animation-delay:-0.3s]" />
            <span className="h-2 w-2 rounded-full bg-sage-500 animate-bounce [animation-delay:-0.15s]" />
            <span className="h-2 w-2 rounded-full bg-sage-500 animate-bounce" />
          </div>
          <div className="font-display text-xl text-paper/85">
            {busy === "build"
              ? "Building your résumé from profile…"
              : busy === "verify"
                ? "Checking the one-page budget…"
                : busy === "trim"
                  ? "Trimming to fit one page…"
                  : "Scoring the built résumé…"}
          </div>
          <div className="mt-2 text-xs text-paper/40">
            This typically takes 30–60 seconds.
          </div>
        </section>
      )}

      {/* Built result */}
      {phase === "built" && builtAnalysis && (
        <>
          <section className="mb-14 animate-rise-in">
            <h2 className="font-display text-3xl font-medium mb-5 flex items-center gap-4 flex-wrap">
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
            <AnalysisCard analysis={builtAnalysis} />
          </section>

          <section className="mb-14 animate-rise-in">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-display text-3xl font-medium">
                  Built LaTeX
                </h2>
                {budgetInfo && <BudgetBadge info={budgetInfo} />}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copyLatex}
                  className="px-3 py-1.5 rounded-md border border-paper/15 text-xs hover:bg-paper/5 hover:border-paper/30 transition"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
                <button
                  onClick={downloadLatex}
                  className="px-3 py-1.5 rounded-md border border-paper/15 text-xs hover:bg-paper/5 hover:border-paper/30 transition"
                >
                  Download .tex
                </button>
                <button
                  onClick={() => openInOverleaf(builtLatex)}
                  className="px-3 py-1.5 rounded-md bg-sage-500 text-ink text-xs font-semibold hover:bg-sage-400 transition"
                  title="Opens overleaf.com in a new tab with your LaTeX pre-loaded for an instant PDF preview."
                >
                  Open in Overleaf ↗
                </button>
              </div>
            </div>
            <pre className="font-mono text-xs bg-ink-raised/60 border border-paper/10 rounded-md p-5 max-h-[600px] overflow-auto whitespace-pre-wrap leading-relaxed">
              {builtLatex}
            </pre>
            <p className="mt-2.5 text-xs text-paper/40">
              Click <span className="text-sage-300">Open in Overleaf</span> for
              an instant PDF preview in a new tab.
            </p>
            {budgetInfo &&
              budgetInfo.iterations > 1 &&
              budgetInfo.cutsApplied.length > 0 && (
                <details className="mt-4 rounded-md border border-paper/10 bg-ink-raised/30 p-4 text-sm">
                  <summary className="cursor-pointer text-paper/70 select-none">
                    <span className="font-display italic text-paper/85">
                      Trimmed to fit one page
                    </span>
                    <span className="text-paper/40 ml-2 text-xs">
                      ({budgetInfo.cutsApplied.length}{" "}
                      {budgetInfo.cutsApplied.length === 1 ? "cut" : "cuts"}{" "}
                      applied)
                    </span>
                  </summary>
                  <ul className="mt-3 space-y-1.5 text-paper/70 list-disc list-outside pl-5">
                    {budgetInfo.cutsApplied.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </details>
              )}
          </section>
        </>
      )}

      <footer className="mt-20 pt-8 border-t border-paper/10 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-paper/40">
        <span className="font-display italic text-sm text-paper/55">
          Resuitme — build mode
        </span>
        <span className="max-w-xl md:text-right leading-relaxed">
          Powered by Claude. Your profile and job description are sent to
          Anthropic for analysis and composition; nothing is stored on this
          server.
        </span>
      </footer>
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
      <div className="rounded-md border border-orange-500/30 bg-orange-500/[0.04] p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="eyebrow text-orange-300 mb-1.5">
            00 — No content pool
          </div>
          <div className="font-display text-base text-orange-100">
            Build a profile to use Build mode.
          </div>
          <div className="text-xs text-paper/55 mt-1.5 leading-relaxed max-w-prose">
            Build mode composes a résumé entirely from your profile — parsed
            entries, CV, and skill notes. Add anything to your profile to
            unlock this mode.
          </div>
        </div>
        <Link
          href="/profile"
          className="text-xs text-orange-200 hover:text-orange-100 border-b border-orange-300/30 hover:border-orange-200 pb-0.5 shrink-0"
        >
          Set up profile →
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-sage-500/25 bg-sage-500/[0.04] p-5 flex items-start justify-between gap-4 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="eyebrow text-sage-400 mb-1.5">
          00 — Template & content pool
        </div>
        <div className="font-display text-base text-paper/90">
          {usingBuiltin ? (
            <>
              Using the built-in{" "}
              <span className="italic">{templateName}</span> template.
            </>
          ) : (
            <>Using your saved base résumé as the LaTeX template.</>
          )}
        </div>
        <div className="text-xs text-paper/55 mt-1.5 leading-relaxed max-w-prose">
          {usingBuiltin ? (
            <>
              {templateDescription}{" "}
              <Link
                href="/profile"
                className="text-sage-300 hover:text-sage-200 underline underline-offset-2"
              >
                Save your own résumé LaTeX
              </Link>{" "}
              in your profile to use your layout instead.{" "}
            </>
          ) : (
            <>Preamble, packages, and macros preserved.{" "}</>
          )}
          {hasParsed ? (
            <>
              Content pool —{" "}
              <span className="text-paper/80 tabular-nums">
                {counts!.exp}
              </span>{" "}
              experiences,{" "}
              <span className="text-paper/80 tabular-nums">
                {counts!.proj}
              </span>{" "}
              projects,{" "}
              <span className="text-paper/80 tabular-nums">
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
        className="text-xs text-sage-300 hover:text-sage-200 border-b border-sage-500/30 hover:border-sage-400 pb-0.5 shrink-0"
      >
        Edit profile →
      </Link>
    </div>
  );
}

function BudgetBadge({ info }: { info: BudgetInfo }) {
  const pct = info.budget > 0 ? info.builtChars / info.budget : 0;
  const overBy = info.builtChars - info.budget;
  const tone = info.fits
    ? "border-sage-500/40 bg-sage-500/10 text-sage-300"
    : "border-red-500/50 bg-red-500/15 text-red-200";
  const icon = info.fits ? "✓" : "⚠";
  return (
    <div
      title={
        `Budget ${info.budget} visible chars (one-page heuristic, with 5% safety margin)\n` +
        `Built ${info.builtChars} chars (${Math.round(pct * 100)}%)\n` +
        (info.iterations > 1
          ? `Trimmed in ${info.iterations} passes${info.cutsApplied.length ? ` — ${info.cutsApplied.length} cuts applied` : ""}`
          : "Fit on the first pass") +
        (info.fits ? "" : `\nOVER BY ${overBy} chars — likely overflows to a second page`)
      }
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border font-mono text-xs tabular-nums ${tone}`}
    >
      <span className="font-semibold">{icon}</span>
      <span>
        {info.builtChars.toLocaleString()}{" "}
        <span className="opacity-50">/</span>{" "}
        {info.budget.toLocaleString()}
      </span>
      <span className="opacity-50">·</span>
      <span>
        {info.fits ? "fits 1 page" : `over by ${overBy.toLocaleString()}`}
      </span>
      {info.iterations > 1 && (
        <>
          <span className="opacity-50">·</span>
          <span>{info.iterations} passes</span>
        </>
      )}
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const color =
    score >= 80
      ? "bg-sage-500/15 text-sage-300 border-sage-500/40"
      : score >= 60
        ? "bg-marigold/15 text-marigold border-marigold/40"
        : score >= 40
          ? "bg-orange-500/15 text-orange-200 border-orange-500/40"
          : "bg-red-500/15 text-red-200 border-red-500/40";
  return (
    <span
      className={`inline-flex items-baseline gap-0.5 px-3 py-1 rounded-full border font-mono text-sm font-medium tabular-nums ${color}`}
    >
      <span className="text-base">{score}</span>
      <span className="opacity-50 text-xs">/100</span>
    </span>
  );
}

function AnalysisCard({ analysis }: { analysis: Analysis }) {
  return (
    <div className="rounded-md border border-paper/10 bg-ink-raised/40 p-6 space-y-6">
      <p className="font-display text-xl md:text-2xl italic leading-snug text-paper/90 border-l-2 border-sage-500/50 pl-4">
        “{analysis.verdict}”
      </p>

      {analysis.must_include?.length > 0 && (
        <MustIncludeBlock picks={analysis.must_include} />
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Block title="Strengths" items={analysis.strengths} tone="positive" />
        <Block title="Gaps" items={analysis.gaps} tone="negative" />
      </div>

      <Block title="Suggested edits" items={analysis.suggestions} />

      <div className="grid md:grid-cols-3 gap-6 text-sm pt-1">
        <KeywordRow
          label="Keywords present"
          words={analysis.keyword_coverage.present}
          tone="positive"
        />
        <KeywordRow
          label="Keywords partial"
          words={analysis.keyword_coverage.partial}
          tone="partial"
        />
        <KeywordRow
          label="Keywords missing"
          words={analysis.keyword_coverage.missing}
          tone="negative"
        />
      </div>
    </div>
  );
}

function MustIncludeBlock({ picks }: { picks: MustIncludePick[] }) {
  return (
    <div className="rounded-md border border-sage-500/30 bg-sage-500/[0.05] p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h3 className="font-display text-lg text-paper/95">
          Top picks for this résumé
        </h3>
        <span className="eyebrow text-sage-400">
          {picks.length} highest-impact items
        </span>
      </div>
      <ol className="space-y-3">
        {picks.map((p, i) => (
          <li
            key={i}
            className="flex gap-3 items-start rounded border border-paper/5 bg-ink/30 px-3.5 py-3"
          >
            <span className="font-mono text-xs text-paper/40 tabular-nums shrink-0 mt-0.5">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-paper/95">{p.item}</div>
              <p className="text-sm text-paper/65 mt-1 leading-relaxed">
                {p.reason}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Block({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone?: "positive" | "negative";
}) {
  const dot =
    tone === "positive"
      ? "bg-sage-400"
      : tone === "negative"
        ? "bg-red-400"
        : "bg-paper/40";
  return (
    <div>
      <h3 className="eyebrow text-paper/55 mb-3">{title}</h3>
      <ul className="space-y-2 text-sm text-paper/80 leading-relaxed">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5">
            <span
              className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${dot}`}
            />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KeywordRow({
  label,
  words,
  tone,
}: {
  label: string;
  words: string[];
  tone: "positive" | "partial" | "negative";
}) {
  const chip =
    tone === "positive"
      ? "bg-sage-500/15 text-sage-200 border-sage-500/30"
      : tone === "partial"
        ? "bg-yellow-500/15 text-yellow-200 border-yellow-500/30"
        : "bg-red-500/15 text-red-200 border-red-500/30";
  return (
    <div>
      <div className="eyebrow text-paper/50 mb-2.5">{label}</div>
      {words.length === 0 ? (
        <div className="text-xs text-paper/40 italic font-display">none</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {words.map((w, i) => (
            <span
              key={i}
              className={`px-2 py-0.5 rounded border font-mono text-xs ${chip}`}
            >
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function HonestyPanel({
  missing,
  honest,
  setVerdict,
  setAllVerdicts,
  honestNotes,
  setHonestNotes,
  onContinue,
  busy,
  ctaLabel,
}: {
  missing: string[];
  honest: Record<string, HonestVerdict>;
  setVerdict: (k: string, v: HonestVerdict) => void;
  setAllVerdicts: (v: HonestVerdict) => void;
  honestNotes: string;
  setHonestNotes: (s: string) => void;
  onContinue: () => void;
  busy: boolean;
  ctaLabel: string;
}) {
  const counts = { have: 0, partial: 0, none: 0 };
  for (const v of Object.values(honest)) counts[v]++;

  return (
    <div className="rounded-md border border-sage-500/25 bg-sage-500/[0.05] p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="eyebrow text-sage-400 mb-2">The honesty check</div>
          <h3 className="font-display text-2xl font-medium text-paper">
            Be honest about these gaps
          </h3>
          <p className="text-sm text-paper/65 mt-2 max-w-2xl leading-relaxed">
            For each keyword the JD wants but your profile doesn&apos;t cover,
            tell us the truth. The built résumé will{" "}
            <em className="text-paper/90 font-display">never</em> claim you
            have something you marked as &quot;I don&apos;t.&quot;
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setAllVerdicts("have")}
            className="text-xs px-2 py-1 rounded border border-sage-500/30 text-sage-200 hover:bg-sage-500/10"
          >
            All: have
          </button>
          <button
            onClick={() => setAllVerdicts("partial")}
            className="text-xs px-2 py-1 rounded border border-yellow-500/30 text-yellow-200 hover:bg-yellow-500/10"
          >
            All: partial
          </button>
          <button
            onClick={() => setAllVerdicts("none")}
            className="text-xs px-2 py-1 rounded border border-red-500/30 text-red-200 hover:bg-red-500/10"
          >
            All: none
          </button>
        </div>
      </div>

      <div className="space-y-1.5 mb-4">
        {missing.map((kw) => {
          const v = honest[kw] ?? "partial";
          return (
            <div
              key={kw}
              className="flex items-center justify-between gap-3 py-2 px-3.5 rounded bg-ink/40 border border-paper/5 hover:border-paper/10 transition-colors"
            >
              <span className="font-mono text-sm text-paper/90 truncate">
                {kw}
              </span>
              <div className="flex gap-1 shrink-0">
                <VerdictButton
                  active={v === "have"}
                  tone="have"
                  onClick={() => setVerdict(kw, "have")}
                >
                  I have this
                </VerdictButton>
                <VerdictButton
                  active={v === "partial"}
                  tone="partial"
                  onClick={() => setVerdict(kw, "partial")}
                >
                  Partial
                </VerdictButton>
                <VerdictButton
                  active={v === "none"}
                  tone="none"
                  onClick={() => setVerdict(kw, "none")}
                >
                  I don&apos;t
                </VerdictButton>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-5">
        <label className="eyebrow text-paper/50 mb-2 block">
          Notes about your experience (optional)
        </label>
        <textarea
          value={honestNotes}
          onChange={(e) => setHonestNotes(e.target.value)}
          placeholder={`e.g. "I've used Postgres heavily but never DynamoDB" or "Familiar with Kubernetes concepts, never deployed one in production"`}
          className="w-full text-sm bg-ink/40 border border-paper/10 rounded-md px-3.5 py-2.5 h-24 resize-y focus:outline-none focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/25 transition-colors placeholder:text-paper/25"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="font-mono text-xs text-paper/50 tabular-nums">
          <span className="text-sage-300">{counts.have} have</span> ·{" "}
          <span className="text-yellow-200">{counts.partial} partial</span> ·{" "}
          <span className="text-red-300">{counts.none} skip</span>
        </div>
        <button
          onClick={onContinue}
          disabled={busy}
          className="px-6 py-3 rounded-md bg-sage-500 text-ink font-semibold text-sm hover:bg-sage-400 disabled:opacity-40 transition shadow-[0_2px_18px_-6px_rgba(116,160,94,0.7)]"
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

function VerdictButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "have" | "partial" | "none";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = "text-xs px-2 py-1 rounded border transition whitespace-nowrap";
  const styles: Record<typeof tone, string> = {
    have: active
      ? "bg-sage-500/30 border-sage-500/60 text-sage-100"
      : "border-paper/10 text-paper/50 hover:border-sage-500/40 hover:text-sage-200",
    partial: active
      ? "bg-yellow-500/25 border-yellow-500/60 text-yellow-100"
      : "border-paper/10 text-paper/50 hover:border-yellow-500/40 hover:text-yellow-200",
    none: active
      ? "bg-red-500/25 border-red-500/60 text-red-100"
      : "border-paper/10 text-paper/50 hover:border-red-500/40 hover:text-red-200",
  };
  return (
    <button onClick={onClick} className={`${base} ${styles[tone]}`}>
      {children}
    </button>
  );
}
