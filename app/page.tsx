"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Analysis } from "@/lib/types";
import { loadProfile, type Profile } from "@/lib/profile";

type Phase = "input" | "analyzed" | "honesty" | "tailoring" | "tailored";

type HonestVerdict = "have" | "partial" | "none";

export default function Home() {
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  const [phase, setPhase] = useState<Phase>("input");
  const [busy, setBusy] = useState<null | "analyze" | "tailor" | "reanalyze">(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const [originalAnalysis, setOriginalAnalysis] = useState<Analysis | null>(
    null,
  );
  const [tailoredLatex, setTailoredLatex] = useState<string>("");
  const [tailoredAnalysis, setTailoredAnalysis] = useState<Analysis | null>(
    null,
  );

  const [copied, setCopied] = useState(false);

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
    setBusy("tailor");
    setPhase("tailoring");
    try {
      const res = await fetch("/api/tailor", {
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tailoring failed");
      setTailoredLatex(data.latex);

      // Auto-reanalyze the tailored version
      setBusy("reanalyze");
      const res2 = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume: data.latex, jobDescription }),
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

  async function copyLatex() {
    await navigator.clipboard.writeText(tailoredLatex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadLatex() {
    const blob = new Blob([tailoredLatex], { type: "text/x-tex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume-tailored.tex";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function openInOverleaf(latex: string) {
    // Overleaf accepts a form POST to /docs with a 'snip' field containing the source.
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
    name.value = "Tailored Resume (Resuitme)";
    form.appendChild(name);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  function reset() {
    setPhase("input");
    setOriginalAnalysis(null);
    setTailoredAnalysis(null);
    setTailoredLatex("");
    setHonest({});
    setHonestNotes("");
    setError(null);
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
        <Link
          href="/profile"
          className="eyebrow text-paper/60 hover:text-marigold border-b border-paper/15 hover:border-marigold pb-1 transition-colors"
        >
          {profile?.updatedAt ? "Your profile →" : "Set up profile →"}
        </Link>
      </nav>

      <header className="mb-14 max-w-3xl">
        <div
          className="eyebrow text-marigold mb-5 animate-rise-in"
          style={{ animationDelay: "60ms" }}
        >
          Honest resume tailoring
        </div>
        <h1
          className="font-display text-5xl md:text-7xl font-medium leading-[0.95] tracking-tight animate-rise-in"
          style={{ animationDelay: "120ms" }}
        >
          Tailor your résumé,{" "}
          <span className="italic text-marigold">truthfully.</span>
        </h1>
        <p
          className="mt-6 text-lg text-paper/65 leading-relaxed max-w-xl animate-rise-in"
          style={{ animationDelay: "220ms" }}
        >
          Paste your LaTeX résumé and a job description. Get an honest rating,
          then a tailored rewrite that only emphasizes skills you{" "}
          <em className="text-paper/90 not-italic font-medium">actually have</em>.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      {/* Input panel */}
      <section
        className="grid md:grid-cols-2 gap-5 mb-6 animate-rise-in"
        style={{ animationDelay: "320ms" }}
      >
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2.5">
            <label className="eyebrow text-paper/55">
              01 — Résumé · LaTeX source
            </label>
            {profile?.baseResumeLatex && (
              <button
                onClick={loadBaseResume}
                disabled={phase !== "input" && phase !== "analyzed"}
                className="text-xs text-sage-300 hover:text-sage-200 underline underline-offset-4 disabled:opacity-40 disabled:no-underline"
              >
                Use my base résumé
              </button>
            )}
          </div>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            disabled={phase !== "input" && phase !== "analyzed"}
            placeholder={`\\documentclass{article}\n\\begin{document}\n...\n\\end{document}`}
            className="font-mono text-sm bg-ink-raised/60 border border-paper/10 rounded-md px-4 py-3 h-72 md:h-96 resize-y focus:outline-none focus:border-marigold/60 focus:ring-1 focus:ring-marigold/30 disabled:opacity-60 transition-colors placeholder:text-paper/25"
          />
          <div className="mt-1.5 text-xs text-paper/40 tabular-nums">
            {resume.length.toLocaleString()} chars
          </div>
        </div>

        <div className="flex flex-col">
          <label className="eyebrow text-paper/55 mb-2.5">
            02 — Job description
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={phase !== "input" && phase !== "analyzed"}
            placeholder="Paste the full job description here…"
            className="text-sm leading-relaxed bg-ink-raised/60 border border-paper/10 rounded-md px-4 py-3 h-72 md:h-96 resize-y focus:outline-none focus:border-marigold/60 focus:ring-1 focus:ring-marigold/30 disabled:opacity-60 transition-colors placeholder:text-paper/25"
          />
          <div className="mt-1.5 text-xs text-paper/40 tabular-nums">
            {jobDescription.length.toLocaleString()} chars
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 mb-16">
        <button
          onClick={analyzeOriginal}
          disabled={!canAnalyze || busy !== null}
          className="group px-6 py-3 rounded-md bg-marigold text-ink font-semibold text-sm hover:bg-marigold-deep disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_2px_20px_-6px_rgba(232,168,56,0.6)] hover:shadow-[0_4px_28px_-6px_rgba(232,168,56,0.8)]"
        >
          {busy === "analyze" ? "Analyzing…" : "Analyze résumé"}
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
            Paste a résumé and a job description to begin.
          </span>
        )}
      </div>

      {/* Original analysis */}
      {originalAnalysis && (
        <section className="mb-14 animate-rise-in">
          <h2 className="font-display text-3xl font-medium mb-5 flex items-center gap-4 flex-wrap">
            Original rating
            <ScorePill score={originalAnalysis.score} />
          </h2>
          <AnalysisCard analysis={originalAnalysis} />

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
                  onTailor={tailor}
                  busy={busy !== null}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={tailor}
                    disabled={busy !== null}
                    className="px-6 py-3 rounded-md bg-sage-500 text-ink font-semibold text-sm hover:bg-sage-400 disabled:opacity-40 transition"
                  >
                    Tailor my résumé to this job →
                  </button>
                  <span className="text-xs text-paper/40 italic font-display">
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
        <section className="mb-14 rounded-md border border-marigold/20 bg-ink-raised/40 p-10 text-center animate-fade-in">
          <div className="flex justify-center gap-1.5 mb-5" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-marigold animate-bounce [animation-delay:-0.3s]" />
            <span className="h-2 w-2 rounded-full bg-marigold animate-bounce [animation-delay:-0.15s]" />
            <span className="h-2 w-2 rounded-full bg-marigold animate-bounce" />
          </div>
          <div className="font-display text-xl text-paper/85">
            {busy === "tailor"
              ? "Tailoring your résumé…"
              : "Re-analyzing the tailored version…"}
          </div>
          <div className="mt-2 text-xs text-paper/40">
            This typically takes 30–60 seconds.
          </div>
        </section>
      )}

      {/* Tailored result */}
      {phase === "tailored" && tailoredAnalysis && (
        <>
          <section className="mb-14 animate-rise-in">
            <h2 className="font-display text-3xl font-medium mb-5 flex items-center gap-4 flex-wrap">
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
            <AnalysisCard analysis={tailoredAnalysis} />
          </section>

          <section className="mb-14 animate-rise-in">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="font-display text-3xl font-medium">
                Tailored LaTeX
              </h2>
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
                  onClick={() => openInOverleaf(tailoredLatex)}
                  className="px-3 py-1.5 rounded-md bg-sage-500 text-ink text-xs font-semibold hover:bg-sage-400 transition"
                  title="Opens overleaf.com in a new tab with your LaTeX pre-loaded for an instant PDF preview."
                >
                  Open in Overleaf ↗
                </button>
              </div>
            </div>
            <pre className="font-mono text-xs bg-ink-raised/60 border border-paper/10 rounded-md p-5 max-h-[600px] overflow-auto whitespace-pre-wrap leading-relaxed">
              {tailoredLatex}
            </pre>
            <p className="mt-2.5 text-xs text-paper/40">
              Click <span className="text-marigold">Open in Overleaf</span> for
              an instant PDF preview in a new tab — Overleaf renders LaTeX with
              full package support.
            </p>
          </section>
        </>
      )}

      <footer className="mt-20 pt-8 border-t border-paper/10 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-paper/40">
        <span className="font-display italic text-sm text-paper/55">
          Resuitme
        </span>
        <span className="max-w-xl md:text-right leading-relaxed">
          Powered by Claude. Your résumé and job description are sent to
          Anthropic for analysis and rewriting; nothing is stored on this
          server. Profile data lives only in your browser&apos;s localStorage.
        </span>
      </footer>
    </main>
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
      <p className="font-display text-xl md:text-2xl italic leading-snug text-paper/90 border-l-2 border-marigold/50 pl-4">
        “{analysis.verdict}”
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <Block title="Strengths" items={analysis.strengths} tone="positive" />
        <Block title="Gaps" items={analysis.gaps} tone="negative" />
      </div>

      <Block title="Suggested edits" items={analysis.suggestions} />

      <div className="grid md:grid-cols-2 gap-6 text-sm pt-1">
        <KeywordRow
          label="Keywords matched"
          words={analysis.keyword_coverage.matched}
          tone="positive"
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
  tone: "positive" | "negative";
}) {
  const chip =
    tone === "positive"
      ? "bg-sage-500/15 text-sage-200 border-sage-500/30"
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
  onTailor,
  busy,
}: {
  missing: string[];
  honest: Record<string, HonestVerdict>;
  setVerdict: (k: string, v: HonestVerdict) => void;
  setAllVerdicts: (v: HonestVerdict) => void;
  honestNotes: string;
  setHonestNotes: (s: string) => void;
  onTailor: () => void;
  busy: boolean;
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
            For each keyword the JD wants but your résumé doesn&apos;t mention,
            tell us the truth. The tailored version will{" "}
            <em className="text-paper/90 font-display">never</em> claim you have
            something you marked as &quot;I don&apos;t.&quot;
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
          className="w-full text-sm bg-ink/40 border border-paper/10 rounded-md px-3.5 py-2.5 h-24 resize-y focus:outline-none focus:border-marigold/50 focus:ring-1 focus:ring-marigold/25 transition-colors placeholder:text-paper/25"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="font-mono text-xs text-paper/50 tabular-nums">
          <span className="text-sage-300">{counts.have} have</span> ·{" "}
          <span className="text-yellow-200">{counts.partial} partial</span> ·{" "}
          <span className="text-red-300">{counts.none} skip</span>
        </div>
        <button
          onClick={onTailor}
          disabled={busy}
          className="px-6 py-3 rounded-md bg-sage-500 text-ink font-semibold text-sm hover:bg-sage-400 disabled:opacity-40 transition shadow-[0_2px_18px_-6px_rgba(116,160,94,0.7)]"
        >
          Tailor honestly →
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
