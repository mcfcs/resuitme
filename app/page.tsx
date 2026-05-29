"use client";

import { useState } from "react";
import type { Analysis } from "@/lib/types";

type Phase = "input" | "analyzed" | "tailoring" | "tailored";

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
      setPhase("analyzed");
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

  function reset() {
    setPhase("input");
    setOriginalAnalysis(null);
    setTailoredAnalysis(null);
    setTailoredLatex("");
    setError(null);
  }

  const canAnalyze = resume.trim().length > 50 && jobDescription.trim().length > 20;

  return (
    <main className="min-h-screen px-6 py-10 md:py-16 max-w-6xl mx-auto">
      <header className="mb-10">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Resuitme
        </h1>
        <p className="mt-2 text-white/60 max-w-2xl">
          Paste your LaTeX resume and a job description. Get an honest rating,
          a tailored rewrite, and a download-ready{" "}
          <code className="text-white/80">.tex</code> file.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      {/* Input panel — always visible */}
      <section className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="flex flex-col">
          <label className="text-sm font-medium mb-2 text-white/80">
            Resume — LaTeX source
          </label>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            disabled={phase !== "input" && phase !== "analyzed"}
            placeholder={`\\documentclass{article}\n\\begin{document}\n...\n\\end{document}`}
            className="font-mono text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 h-72 md:h-96 resize-y focus:outline-none focus:border-white/30 disabled:opacity-60"
          />
          <div className="mt-1 text-xs text-white/40">
            {resume.length.toLocaleString()} chars
          </div>
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-medium mb-2 text-white/80">
            Job description
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={phase !== "input" && phase !== "analyzed"}
            placeholder="Paste the full job description here..."
            className="text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 h-72 md:h-96 resize-y focus:outline-none focus:border-white/30 disabled:opacity-60"
          />
          <div className="mt-1 text-xs text-white/40">
            {jobDescription.length.toLocaleString()} chars
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 mb-10">
        <button
          onClick={analyzeOriginal}
          disabled={!canAnalyze || busy !== null}
          className="px-5 py-2.5 rounded-lg bg-white text-black font-medium text-sm hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {busy === "analyze" ? "Analyzing…" : "Analyze resume"}
        </button>
        {phase !== "input" && (
          <button
            onClick={reset}
            disabled={busy !== null}
            className="px-4 py-2.5 rounded-lg border border-white/15 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40 transition"
          >
            Start over
          </button>
        )}
        {!canAnalyze && (
          <span className="text-xs text-white/40">
            Paste a resume and a job description to begin.
          </span>
        )}
      </div>

      {/* Original analysis */}
      {originalAnalysis && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-3">
            Original resume rating
            <ScorePill score={originalAnalysis.score} />
          </h2>
          <AnalysisCard analysis={originalAnalysis} />

          {phase === "analyzed" && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={tailor}
                disabled={busy !== null}
                className="px-5 py-2.5 rounded-lg bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400 disabled:opacity-40 transition"
              >
                Tailor my resume to this job →
              </button>
              <span className="text-xs text-white/40">
                The model will rewrite your LaTeX in-place, preserving your
                preamble and packages.
              </span>
            </div>
          )}
        </section>
      )}

      {/* Tailoring state */}
      {phase === "tailoring" && (
        <section className="mb-10 rounded-lg border border-white/10 p-6 text-center">
          <div className="text-sm text-white/70">
            {busy === "tailor"
              ? "Tailoring your resume…"
              : "Re-analyzing the tailored version…"}
          </div>
          <div className="mt-3 text-xs text-white/40">
            This typically takes 30–60 seconds.
          </div>
        </section>
      )}

      {/* Tailored result */}
      {phase === "tailored" && tailoredAnalysis && (
        <>
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-3">
              Tailored resume rating
              <ScorePill score={tailoredAnalysis.score} />
              {originalAnalysis && (
                <span className="text-sm font-normal text-white/50">
                  was{" "}
                  <span className="text-white/70">
                    {originalAnalysis.score}
                  </span>
                  {tailoredAnalysis.score > originalAnalysis.score && (
                    <span className="ml-2 text-emerald-400">
                      +{tailoredAnalysis.score - originalAnalysis.score}
                    </span>
                  )}
                </span>
              )}
            </h2>
            <AnalysisCard analysis={tailoredAnalysis} />
          </section>

          <section className="mb-10">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-xl font-semibold">Tailored LaTeX</h2>
              <div className="flex gap-2">
                <button
                  onClick={copyLatex}
                  className="px-3 py-1.5 rounded-md border border-white/15 text-xs hover:bg-white/5 transition"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={downloadLatex}
                  className="px-3 py-1.5 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition"
                >
                  Download .tex
                </button>
              </div>
            </div>
            <pre className="font-mono text-xs bg-white/5 border border-white/10 rounded-lg p-4 max-h-[600px] overflow-auto whitespace-pre-wrap">
              {tailoredLatex}
            </pre>
          </section>
        </>
      )}

      <footer className="mt-16 pt-8 border-t border-white/10 text-xs text-white/40">
        Powered by Claude. Your resume and job description are sent to
        Anthropic for analysis and rewriting; nothing is stored on this server.
      </footer>
    </main>
  );
}

function ScorePill({ score }: { score: number }) {
  const color =
    score >= 80
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
      : score >= 60
        ? "bg-yellow-500/20 text-yellow-200 border-yellow-500/40"
        : score >= 40
          ? "bg-orange-500/20 text-orange-200 border-orange-500/40"
          : "bg-red-500/20 text-red-200 border-red-500/40";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full border text-sm font-semibold ${color}`}
    >
      {score}/100
    </span>
  );
}

function AnalysisCard({ analysis }: { analysis: Analysis }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5 space-y-5">
      <p className="text-white/85 italic">"{analysis.verdict}"</p>

      <div className="grid md:grid-cols-2 gap-5">
        <Block title="Strengths" items={analysis.strengths} tone="positive" />
        <Block title="Gaps" items={analysis.gaps} tone="negative" />
      </div>

      <Block title="Suggested edits" items={analysis.suggestions} />

      <div className="grid md:grid-cols-2 gap-5 text-sm">
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
      ? "bg-emerald-400"
      : tone === "negative"
        ? "bg-red-400"
        : "bg-white/40";
  return (
    <div>
      <h3 className="text-sm font-semibold text-white/80 mb-2">{title}</h3>
      <ul className="space-y-1.5 text-sm text-white/75">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span
              className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${dot}`}
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
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
      : "bg-red-500/15 text-red-200 border-red-500/30";
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-white/50 mb-2">
        {label}
      </div>
      {words.length === 0 ? (
        <div className="text-xs text-white/40 italic">none</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {words.map((w, i) => (
            <span
              key={i}
              className={`px-2 py-0.5 rounded-md border text-xs ${chip}`}
            >
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
