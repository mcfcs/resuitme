"use client";

// A titled LaTeX textarea with a file-upload affordance. Used for both the
// base résumé and the base CV.

import { useRef } from "react";

export default function DocumentBlock({
  title,
  description,
  value,
  onChange,
  onFile,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onFile: (f: File | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section className="mb-10 md:mb-12">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-medium sm:text-2xl">
            {title}
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-paper/60">
            {description}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".tex,text/plain,text/x-tex"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="min-h-[2.5rem] rounded-md border border-paper/15 px-3 text-xs transition hover:border-marigold/50 hover:bg-paper/5 hover:text-marigold sm:min-h-0 sm:py-1.5"
          >
            Upload .tex
          </button>
        </div>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="Paste LaTeX source or upload a .tex file…"
        className="h-48 w-full resize-y rounded-md border border-paper/10 bg-ink-raised/60 px-4 py-3 font-mono text-sm transition-colors placeholder:text-paper/25 focus:border-marigold/60 focus:outline-none focus:ring-1 focus:ring-marigold/30 sm:h-64"
      />
      <div className="mt-1.5 text-xs tabular-nums text-paper/40">
        {value.length.toLocaleString()} chars
      </div>
    </section>
  );
}
