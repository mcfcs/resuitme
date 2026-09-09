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
      label: hasProfile ? "Your profile" : "Set up profile",
      accent: "marigold" as const,
    },
  ].filter((l) =>
    l.href === "/" ? pathname !== "/" : !pathname.startsWith(l.href),
  );

  return (
    <nav className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:mb-5">
      <Link
        href="/"
        className="shrink-0 font-display text-lg font-semibold tracking-tight text-paper/90 transition-colors hover:text-paper"
        aria-label="Resuitme home"
      >
        Resuitme
      </Link>

      {/* Desktop only: the bottom tab bar covers navigation on small screens. */}
      <div className="hidden items-center gap-6 md:flex">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="text-sm text-paper/55 underline-offset-[6px] transition-colors hover:text-paper hover:underline"
          >
            {l.label}
          </Link>
        ))}
      </div>

      {trailing ? (
        <div className="order-last flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 sm:order-none sm:w-auto sm:justify-end">
          {trailing}
        </div>
      ) : null}
    </nav>
  );
}
