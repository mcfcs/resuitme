"use client";

// Shows which layout the build will use (the user's saved résumé LaTeX, or the
// built-in template) and what profile content is available to draw from.

import Link from "next/link";
import type { Profile } from "@/lib/profile";

export default function TemplateCard({
  profile,
  usingBuiltin,
  hasProfileContent,
  templateName,
  templateDescription,
}: {
  profile: Profile | null;
  usingBuiltin: boolean;
  hasProfileContent: boolean;
  templateName: string;
  templateDescription: string;
}) {
  const hasParsed = !!profile?.parsed;
  const hasCv = !!profile?.baseCvLatex?.trim();
  const hasNotes = !!profile?.additionalSkills?.trim();
  const counts = hasParsed
    ? {
        exp: profile!.parsed!.experience.length,
        proj: profile!.parsed!.projects.length,
        skills: profile!.parsed!.skills.flat.length,
      }
    : null;

  if (!hasProfileContent) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-orange-500/30 bg-orange-500/[0.04] p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="eyebrow mb-1.5 text-orange-300">
            00 — No content pool
          </div>
          <div className="font-display text-base text-orange-100">
            Build a profile to use Build mode.
          </div>
          <div className="mt-1.5 max-w-prose text-xs leading-relaxed text-paper/55">
            Build mode composes a résumé entirely from your profile — parsed
            entries, CV, and skill notes. Add anything to your profile to unlock
            this mode.
          </div>
        </div>
        <Link
          href="/profile"
          className="shrink-0 border-b border-orange-300/30 pb-0.5 text-xs text-orange-200 hover:border-orange-200 hover:text-orange-100"
        >
          Set up profile →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-sage-500/25 bg-sage-500/[0.04] p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <div className="eyebrow mb-1.5 text-sage-400">
          00 — Template &amp; content pool
        </div>
        <div className="font-display text-base text-paper/90">
          {usingBuiltin ? (
            <>
              Using the built-in <span className="italic">{templateName}</span>{" "}
              template.
            </>
          ) : (
            <>Using your saved base résumé as the LaTeX template.</>
          )}
        </div>
        <div className="mt-1.5 max-w-prose text-xs leading-relaxed text-paper/55">
          {usingBuiltin ? (
            <>
              {templateDescription}{" "}
              <Link
                href="/profile"
                className="text-sage-300 underline underline-offset-2 hover:text-sage-200"
              >
                Save your own résumé LaTeX
              </Link>{" "}
              in your profile to use your layout instead.{" "}
            </>
          ) : (
            <>Preamble, packages, and macros preserved. </>
          )}
          {hasParsed ? (
            <>
              Content pool —{" "}
              <span className="tabular-nums text-paper/80">{counts!.exp}</span>{" "}
              experiences,{" "}
              <span className="tabular-nums text-paper/80">{counts!.proj}</span>{" "}
              projects,{" "}
              <span className="tabular-nums text-paper/80">
                {counts!.skills}
              </span>{" "}
              skills available.
            </>
          ) : hasCv ? (
            <>Content pool: your base CV LaTeX.</>
          ) : hasNotes ? (
            <>Content pool: your skills notes.</>
          ) : null}
        </div>
      </div>
      <Link
        href="/profile"
        className="shrink-0 border-b border-sage-500/30 pb-0.5 text-xs text-sage-300 hover:border-sage-400 hover:text-sage-200"
      >
        Edit profile →
      </Link>
    </div>
  );
}
