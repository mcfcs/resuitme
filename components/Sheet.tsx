"use client";

// The layout primitives the app never had. Previously the visual system existed
// only as class strings duplicated across files — `rounded-md border
// border-paper/10 bg-ink-raised/40` appeared verbatim five times, and every
// kind of content wore identical chrome.
//
// The organising idea is typesetting: the dark ground is a press bed, and the
// interface is printed on a sheet of stock laid on it. Surfaces are
// differentiated by ROLE, not by tinting the same box a different colour.

import type { ReactNode } from "react";

/**
 * The sheet. Everything the user reads sits on this.
 *
 * Deliberately not a rounded card: it is a piece of stock, so it squares off
 * and casts a real shadow onto the bed.
 */
export function Sheet({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-stock text-type-body shadow-[0_1px_2px_rgba(0,0,0,0.32),0_18px_50px_-24px_rgba(0,0,0,0.75)] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A titled region of the sheet, separated by a rule rather than a box.
 *
 * Rules are how typeset documents divide content, and they carry the same
 * information a border does at a fraction of the visual weight.
 */
export function Region({
  title,
  aside,
  children,
  className = "",
}: {
  title?: string;
  /** Right-hand metadata: a count, a score, a control. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-t border-type-strong/12 pt-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {title && (
            <h2 className="font-display text-xl font-medium text-type-strong sm:text-2xl">
              {title}
            </h2>
          )}
          {aside && <div className="text-sm text-type-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A short note in the margin — the voice for hints and secondary facts.
 *
 * Replaces the italic-serif aside that was used eight times for everything
 * from empty states to tooltips.
 */
export function Note({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`max-w-measure text-sm leading-relaxed text-type-muted ${className}`}
    >
      {children}
    </p>
  );
}

/** A callout that needs to be read, not skimmed past. */
export function Notice({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "neutral" | "warn" | "bad";
  children: ReactNode;
  className?: string;
}) {
  const border =
    tone === "bad"
      ? "border-l-rust"
      : tone === "warn"
        ? "border-l-marigold"
        : "border-l-type-strong/30";
  return (
    <div
      className={`border-l-2 bg-stock-shade/60 py-3 pl-4 pr-3 text-sm leading-relaxed text-type-body ${border} ${className}`}
    >
      {children}
    </div>
  );
}
