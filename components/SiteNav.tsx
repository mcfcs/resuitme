"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { loadProfile } from "@/lib/profile";

/**
 * Top bar. On mobile it collapses to the wordmark plus a compact profile
 * status chip — the mode switching lives in MobileTabBar instead, so the
 * three text links never have to compete for a 375px-wide row.
 */
export default function SiteNav({
  /** Extra controls rendered on the right (e.g. the profile page's actions). */
  trailing,
}: {
  trailing?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    setHasProfile(!!loadProfile()?.updatedAt);
  }, []);

  const links = [
    { href: "/", label: "Tailor mode", accent: "marigold" as const },
    { href: "/build", label: "Build mode", accent: "sage" as const },
    {
      href: "/profile",
      label: hasProfile ? "Your profile →" : "Set up profile →",
      accent: "marigold" as const,
    },
  ].filter((l) =>
    l.href === "/" ? pathname !== "/" : !pathname.startsWith(l.href),
  );

  return (
    <nav className="mb-8 flex items-center justify-between gap-4 md:mb-12 animate-fade-in">
      <Link
        href="/"
        className="group flex shrink-0 items-baseline gap-0.5"
        aria-label="Resuitme home"
      >
        <span className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
          Resuitme
        </span>
        <span className="font-display text-xl italic leading-none text-marigold sm:text-2xl">
          .
        </span>
      </Link>

      {/* Desktop: full text nav. Mobile: the bottom tab bar covers this. */}
      <div className="hidden items-center gap-5 md:flex">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`eyebrow border-b pb-1 text-paper/60 transition-colors ${
              l.accent === "sage"
                ? "border-transparent hover:border-sage-400 hover:text-sage-300"
                : "border-paper/15 hover:border-marigold hover:text-marigold"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>

      {trailing ? (
        <div className="flex items-center gap-3 md:gap-4">{trailing}</div>
      ) : null}
    </nav>
  );
}
