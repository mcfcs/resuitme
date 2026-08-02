"use client";

import type { Accent, Analysis, MustIncludePick } from "@/lib/types";

/**
 * Shared analysis presentation, used identically by tailor mode and build mode
 * (they differ only in accent colour). Extracted so responsive behaviour is
 * defined once instead of drifting between the two pages.
 */

export function ScorePill({ score }: { score: number }) {
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
      className={`inline-flex items-baseline gap-0.5 rounded-full border px-3 py-1 font-mono text-sm font-medium tabular-nums ${color}`}
    >
      <span className="text-base">{score}</span>
      <span className="text-xs opacity-50">/100</span>
    </span>
  );
}

export function AnalysisCard({
  analysis,
  accent = "marigold",
}: {
  analysis: Analysis;
  accent?: Accent;
}) {
  const rule = accent === "sage" ? "border-sage-500/50" : "border-marigold/50";
  return (
    <div className="space-y-6 rounded-md border border-paper/10 bg-ink-raised/40 p-4 sm:p-6">
      <p
        className={`border-l-2 pl-4 font-display text-lg italic leading-snug text-paper/90 sm:text-xl md:text-2xl ${rule}`}
      >
        “{analysis.verdict}”
      </p>

      {analysis.must_include?.length > 0 && (
        <MustIncludeBlock picks={analysis.must_include} accent={accent} />
      )}

      <div className="grid gap-5 sm:gap-6 md:grid-cols-2">
        <Block title="Strengths" items={analysis.strengths} tone="positive" />
        <Block title="Gaps" items={analysis.gaps} tone="negative" />
      </div>

      <Block title="Suggested edits" items={analysis.suggestions} />

      <div className="grid gap-5 pt-1 text-sm sm:gap-6 md:grid-cols-3">
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

function MustIncludeBlock({
  picks,
  accent,
}: {
  picks: MustIncludePick[];
  accent: Accent;
}) {
  const box =
    accent === "sage"
      ? "border-sage-500/30 bg-sage-500/[0.05]"
      : "border-marigold/30 bg-marigold/[0.05]";
  const eyebrow = accent === "sage" ? "text-sage-400" : "text-marigold";
  return (
    <div className={`rounded-md border p-4 sm:p-5 ${box}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base text-paper/95 sm:text-lg">
          Top picks for this résumé
        </h3>
        <span className={`eyebrow ${eyebrow}`}>
          {picks.length} highest-impact items
        </span>
      </div>
      <ol className="space-y-3">
        {picks.map((p, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded border border-paper/5 bg-ink/30 px-3 py-3 sm:px-3.5"
          >
            <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-paper/40">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-paper/95">{p.item}</div>
              <p className="mt-1 text-sm leading-relaxed text-paper/65">
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
      <h3 className="eyebrow mb-3 text-paper/55">{title}</h3>
      <ul className="space-y-2 text-sm leading-relaxed text-paper/80">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5">
            <span
              className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
            />
            <span className="min-w-0">{it}</span>
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
      <div className="eyebrow mb-2.5 text-paper/50">{label}</div>
      {words.length === 0 ? (
        <div className="font-display text-xs italic text-paper/40">none</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {words.map((w, i) => (
            <span
              key={i}
              className={`rounded border px-2 py-0.5 font-mono text-xs break-all ${chip}`}
            >
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
