"use client";

// Shows what a résumé parser actually extracts from the compiled PDF, and how
// that scores. Mirrors components/Analysis.tsx so the two cards read as one
// system (same ScorePill vocabulary, same Accent prop).
//
// The "as the parser sees it" panel is the point of this component. An abstract
// score invites argument; the raw extracted text ends it — a user who sees
// their own bullet come out as control characters understands instantly.

import { useState } from "react";
import type { Accent } from "@/lib/types";
import type { AtsScanResult } from "@/lib/render";
import type { AtsFinding } from "@/lib/ats/source-lint";

export function AtsScorePill({ score }: { score: number }) {
  const color =
    score >= 90
      ? "bg-sage-500/15 text-sage-300 border-sage-500/40"
      : score >= 75
        ? "bg-marigold/15 text-marigold border-marigold/40"
        : score >= 50
          ? "bg-orange-500/15 text-orange-200 border-orange-500/40"
          : "bg-red-500/15 text-red-200 border-red-500/40";
  return (
    <span
      className={`inline-flex items-baseline gap-0.5 rounded-full border px-3 py-1 font-mono text-sm font-medium tabular-nums ${color}`}
    >
      <span className="text-base">{score}</span>
      <span className="text-xs opacity-50">/100</span>
    </span>
  );
}

function CheckRow({
  label,
  detail,
  points,
  weight,
  passed,
}: {
  label: string;
  detail: string;
  points: number;
  weight: number;
  passed: boolean;
}) {
  return (
    <li className="flex gap-3 py-2">
      <span
        aria-hidden
        className={`mt-0.5 select-none font-mono text-xs ${
          passed ? "text-sage-300" : "text-orange-300"
        }`}
      >
        {passed ? "✓" : "✕"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm text-paper/85">{label}</span>
          <span className="font-mono text-xs tabular-nums text-paper/40">
            {points}/{weight}
          </span>
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-paper/55">
          {detail}
        </span>
      </span>
    </li>
  );
}

const SEVERITY_STYLE: Record<AtsFinding["severity"], string> = {
  critical: "text-red-200",
  warning: "text-orange-200",
  info: "text-paper/60",
};

export default function AtsReport({
  scan,
  findings = [],
  accent = "marigold",
}: {
  /** Null when the scan was unavailable — we then show source findings only. */
  scan: AtsScanResult | null;
  /** Static LaTeX lint results, available even without a compile. */
  findings?: AtsFinding[];
  accent?: Accent;
}) {
  const [showText, setShowText] = useState(false);
  const rule = accent === "sage" ? "border-sage-500/50" : "border-marigold/50";

  if (!scan && findings.length === 0) return null;

  return (
    <section className="space-y-4 rounded-md border border-paper/10 bg-ink-raised/40 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow mb-1 text-paper/45">ATS check</div>
          <h3 className="font-display text-lg font-medium sm:text-xl">
            What a résumé parser reads
          </h3>
        </div>
        {scan && <AtsScorePill score={scan.score} />}
      </header>

      {scan ? (
        <>
          <ul className="divide-y divide-paper/5">
            {scan.checks.map((c) => (
              <CheckRow
                key={c.id}
                label={c.label}
                detail={c.detail}
                points={c.points}
                weight={c.weight}
                passed={c.passed}
              />
            ))}
          </ul>

          <div>
            <button
              onClick={() => setShowText((v) => !v)}
              className="text-xs text-paper/50 underline underline-offset-4 transition hover:text-paper/80"
            >
              {showText ? "Hide" : "Show"} the text a parser extracts
            </button>
            {showText && (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-paper/10 bg-ink/60 p-3 font-mono text-[11px] leading-relaxed text-paper/70">
                {scan.text}
              </pre>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-paper/60">
          Couldn&apos;t compile and scan the PDF, so this is a source-level
          check only.
        </p>
      )}

      {findings.length > 0 && (
        <div className={`border-l-2 pl-4 ${rule}`}>
          <div className="eyebrow mb-2 text-paper/45">
            Source findings ({findings.length})
          </div>
          <ul className="space-y-3">
            {findings.map((f, i) => (
              <li key={`${f.id}-${i}`} className="text-sm">
                <span className={`font-medium ${SEVERITY_STYLE[f.severity]}`}>
                  {f.title}
                </span>
                <p className="mt-0.5 text-xs leading-relaxed text-paper/55">
                  {f.detail}
                </p>
                {f.fix && (
                  <p className="mt-1 text-xs leading-relaxed text-paper/70">
                    <span className="text-paper/45">Fix: </span>
                    {f.fix}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
