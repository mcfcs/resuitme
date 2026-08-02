"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  href: string;
  label: string;
  /** Active accent, matching each mode's colour in the desktop UI. */
  accent: string;
  icon: React.ReactNode;
};

const TABS: Tab[] = [
  {
    href: "/",
    label: "Tailor",
    accent: "text-marigold",
    icon: (
      // Document with a pen
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L14 13l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/build",
    label: "Build",
    accent: "text-sage-300",
    icon: (
      // Stacked blocks
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <path d="M16.5 13.5v6M13.5 16.5h6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Profile",
    accent: "text-marigold",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
      </svg>
    ),
  },
];

/**
 * Bottom tab bar — mobile only. Replaces the cramped inline text nav on small
 * screens and gives the standalone (Add to Home Screen) app a native feel.
 * Sits above the iOS home indicator via the safe-area inset.
 */
export default function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-50 border-t border-paper/10 bg-ink/95 backdrop-blur-lg pb-safe"
    >
      <ul className="flex items-stretch">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-1 px-2 py-2 transition-colors ${
                  active ? tab.accent : "text-paper/45 active:text-paper/70"
                }`}
              >
                <span className="h-[22px] w-[22px]">{tab.icon}</span>
                <span className="text-[11px] font-medium leading-none tracking-wide">
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
