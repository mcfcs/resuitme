"use client";

// Which input(s) an item came from: résumé, CV, or free-form notes. The merge
// prompt tags every item with these, and the badges surface that provenance.

import type { Source } from "@/lib/profile";

export default function SourceBadge({ source }: { source: Source }) {
  const style: Record<Source, string> = {
    resume: "bg-type-strong/15 text-type-body border-sky-500/30",
    cv: "bg-type-strong/15 text-type-body border-purple-500/30",
    notes: "bg-marigold/15 text-marigold-deep border-amber-500/30",
  };
  const label: Record<Source, string> = {
    resume: "resume",
    cv: "cv",
    notes: "notes",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-[1px] text-[10px] uppercase tracking-wider border ${style[source]}`}
    >
      {label[source]}
    </span>
  );
}

export function SourceBadges({ sources }: { sources: Source[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="inline-flex items-center gap-1 ml-2 align-middle">
      {sources.map((s) => (
        <SourceBadge key={s} source={s} />
      ))}
    </div>
  );
}
