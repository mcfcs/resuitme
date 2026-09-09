"use client";

// Which input(s) an item came from: résumé, CV, or free-form notes. The merge
// prompt tags every item with these, and the badges surface that provenance.

import type { Source } from "@/lib/profile";

export default function SourceBadge({ source }: { source: Source }) {
  const style: Record<Source, string> = {
    resume: "bg-sky-500/15 text-sky-200 border-sky-500/30",
    cv: "bg-purple-500/15 text-purple-200 border-purple-500/30",
    notes: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  };
  const label: Record<Source, string> = {
    resume: "resume",
    cv: "cv",
    notes: "notes",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-[1px] rounded-md text-[10px] uppercase tracking-wider border ${style[source]}`}
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
