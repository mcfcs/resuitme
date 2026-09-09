"use client";

// One shell for every page. `app/page.tsx` and `app/build/page.tsx` were ~85%
// identical — the same container, the same eyebrow→display→paragraph hero with
// the same 60/120/220ms animation staircase, differing only in accent colour.
//
// The hero is now a masthead: the product name set as a colophon line, and the
// page's actual subject stated once. No eyebrow, no italicised last word, no
// per-element animation delays.

import type { ReactNode } from "react";
import type { Accent } from "@/lib/types";
import SiteNav from "@/components/SiteNav";

export default function PageShell({
  title,
  intro,
  accent = "marigold",
  nav,
  footer,
  children,
}: {
  title: string;
  intro?: ReactNode;
  accent?: Accent;
  /** Extra controls for the nav bar, e.g. profile's export/import. */
  nav?: ReactNode;
  /** Colophon, rendered on the press bed BELOW the sheet — not on it. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const mark = accent === "sage" ? "bg-sage-ink" : "bg-marigold";

  return (
    <div className="min-h-screen px-4 pb-tabbar pt-4 px-safe sm:px-6 sm:pt-6 lg:px-10 lg:pt-10">
      <main className="mx-auto max-w-[78rem]">
        <SiteNav trailing={nav} />

        {/* The sheet. One surface; regions inside it are divided by rules. */}
        <div className="bg-stock text-type-body shadow-[0_1px_2px_rgba(0,0,0,0.32),0_18px_50px_-24px_rgba(0,0,0,0.75)]">
          <header className="border-b border-type-strong/12 px-5 pb-7 pt-8 sm:px-8 lg:px-12 lg:pb-9 lg:pt-11">
            {/* A register mark: the one piece of colour on the sheet. */}
            <span aria-hidden className={`mb-5 block h-[3px] w-10 ${mark}`} />
            <h1 className="max-w-[22ch] font-display text-3xl font-medium leading-[1.06] tracking-[-0.015em] text-type-strong sm:text-4xl lg:text-5xl">
              {title}
            </h1>
            {intro && (
              <div className="mt-4 max-w-measure text-[0.975rem] leading-[1.65] text-type-muted lg:mt-5">
                {intro}
              </div>
            )}
          </header>

          <div className="space-y-8 px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
            {children}
          </div>
        </div>

        {footer}
      </main>
    </div>
  );
}
