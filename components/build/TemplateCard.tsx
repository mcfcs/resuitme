"use client";

// Shows which layout the build will use (the user's saved résumé LaTeX, or the
// built-in template) and what profile content is available to draw from.

import Link from "next/link";
import type { Profile } from "@/lib/profile";
import { TEMPLATES } from "@/lib/templates";

export default function TemplateCard({
  profile,
  usingBuiltin,
  hasProfileContent,
  templateName,
  templateDescription,
  templateId,
  onSelectTemplate,
}: {
  profile: Profile | null;
  usingBuiltin: boolean;
  hasProfileContent: boolean;
  templateName: string;
  templateDescription: string;
  templateId: string;
  onSelectTemplate: (id: string) => void;
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
    <div className="rounded-md border border-sage-500/25 bg-sage-500/[0.04] p-4 sm:p-5">
      <TemplatePicker selected={templateId} onSelect={onSelectTemplate} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="eyebrow mb-1.5 text-sage-400">
            00 — Template &amp; content pool
          </div>
          <div className="font-display text-base text-paper/90">
            {usingBuiltin ? (
              <>
                Using the built-in{" "}
                <span className="italic">{templateName}</span> template.
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
                <span className="tabular-nums text-paper/80">
                  {counts!.exp}
                </span>{" "}
                experiences,{" "}
                <span className="tabular-nums text-paper/80">
                  {counts!.proj}
                </span>{" "}
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
    </div>
  );
}

/**
 * Layout selector. Only single-column layouts are offered: two-column designs
 * measurably lose ATS reading order, which is the opposite of the point.
 * Renders nothing while there is only one layout to choose from.
 */
function TemplatePicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const options = Object.values(TEMPLATES);
  if (options.length < 2) return null;

  return (
    <div className="mb-4 border-b border-sage-500/15 pb-4">
      <div className="eyebrow mb-2 text-sage-400">Layout</div>
      <div className="flex flex-wrap gap-2">
        {options.map((t) => {
          const active = t.id === selected;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              aria-pressed={active}
              title={t.description}
              className={
                active
                  ? "rounded-md border border-sage-500/60 bg-sage-500/15 px-3 py-1.5 text-xs text-sage-200 transition"
                  : "rounded-md border border-paper/12 px-3 py-1.5 text-xs text-paper/60 transition hover:border-paper/25 hover:bg-paper/5"
              }
            >
              {t.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
