"use client";

// Profile page — the user's source of truth.
//
// This component is now composition only. Data and state logic live in
// app/profile/hooks/, and every presentational chunk lives in
// components/profile/.

import { useRef } from "react";
import PageShell from "@/components/PageShell";
import { Notice } from "@/components/Sheet";
import DocumentBlock from "@/components/profile/DocumentBlock";
import AddToCvPanel from "@/components/profile/AddToCvPanel";
import ParsedProfileView from "@/components/profile/ParsedProfileView";
import SourceBadge from "@/components/profile/SourceBadge";
import { useProfileStorage } from "@/app/profile/hooks/useProfileStorage";
import { useCvAdder } from "@/app/profile/hooks/useCvAdder";

export default function ProfilePage() {
  const {
    profile,
    setProfile,
    set,
    busy,
    error,
    saved,
    hydrated,
    profileViewRef,
    handleFile,
    build,
    saveInputsOnly,
    reset,
    exportProfile,
    importProfile,
    hasAnyInput,
    builtSources,
  } = useProfileStorage();

  // Hidden <input type=file> driven by the Import button.
  const importRef = useRef<HTMLInputElement>(null);

  const adder = useCvAdder({ profile, setProfile });

  if (!hydrated) {
    return (
      <div className="min-h-screen px-4 py-10 px-safe sm:px-6">
        <p className="text-sm text-paper/50">Loading your profile…</p>
      </div>
    );
  }

  return (
    <PageShell
      title="Everything you have, in one place"
      intro={
        <>
          Paste your base résumé, a fuller CV, and any loose notes. Resuitme
          merges them into one profile — deduplicating what overlaps and keeping
          the more complete version of each entry.
        </>
      }
      nav={
        <>
          {profile.updatedAt && (
            <span className="hidden text-xs tabular-nums text-paper/40 lg:inline">
              Last saved {new Date(profile.updatedAt).toLocaleString()}
            </span>
          )}
          <button
            onClick={exportProfile}
            disabled={!hasAnyInput && !profile.parsed}
            className="shrink-0 text-sm text-paper/55 transition-colors hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export profile
          </button>
          <button
            onClick={() => importRef.current?.click()}
            className="shrink-0 text-sm text-paper/55 transition-colors hover:text-paper"
          >
            Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              void importProfile(e.target.files?.[0] ?? null);
              // Reset so re-picking the same file fires change again.
              e.target.value = "";
            }}
          />
          <button
            onClick={reset}
            className="shrink-0 text-sm text-paper/55 transition-colors hover:text-rust"
          >
            Clear profile
          </button>
        </>
      }
    >
      {error && (
        <Notice tone="bad">
          <strong className="font-medium text-type-strong">
            Something went wrong.
          </strong>{" "}
          {error}
        </Notice>
      )}

      <DocumentBlock
        title="Base resume (LaTeX)"
        description="Your standard, untailored resume. Becomes the starting point when you click 'Use my base resume' on the tailor page."
        value={profile.baseResumeLatex ?? ""}
        onChange={(v) => set("baseResumeLatex", v)}
        onFile={(f) => handleFile("resume", f)}
      />

      <DocumentBlock
        title="Base CV (LaTeX)"
        description="Optional. A longer comprehensive CV — anything that didn't fit on the resume. Merged into the same profile."
        value={profile.baseCvLatex ?? ""}
        onChange={(v) => set("baseCvLatex", v)}
        onFile={(f) => handleFile("cv", f)}
      />

      <section>
        <h2 className="mb-1.5 font-display text-xl font-medium sm:text-2xl">
          Additional skills &amp; notes
        </h2>
        <p className="mb-4 max-w-2xl text-sm leading-relaxed text-type-muted">
          Anything you have that isn&apos;t on your résumé or CV. Tools,
          languages, projects, in-progress certifications. Free form. Merged in
          and tagged as &quot;notes&quot;.
        </p>
        <textarea
          value={profile.additionalSkills ?? ""}
          onChange={(e) => set("additionalSkills", e.target.value)}
          placeholder={`e.g.
- Comfortable with Rust (used in personal projects, not on resume)
- AWS Solutions Architect Associate (studying for the exam, no cert yet)
- Currently learning Kubernetes
- Conversational Spanish`}
          className="w-full text-sm bg-stock-shade/50 border border-type-strong/12 px-4 py-3 h-40 resize-y focus-visible:outline-none focus-visible:border-marigold focus-visible:ring-1 focus-visible:ring-marigold/40 transition-colors placeholder:text-type-faint"
        />
      </section>

      {/* AI-assisted CV addition */}
      <section>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-medium sm:text-2xl">
              Add to CV with AI
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-type-muted">
              Describe a new experience, project, or other entry. The model
              polishes your input into clean CV-quality content, you review, and
              on confirm it&apos;s inserted into your base CV LaTeX. Your résumé
              stays untouched — the CV is the full source of truth.
            </p>
          </div>
        </div>

        {!profile.baseCvLatex?.trim() ? (
          <div className="border border-type-strong/12 bg-stock-shade/40 p-4 text-sm text-type-muted">
            Paste a base CV above first — this feature inserts entries into your
            existing CV LaTeX, matching its formatting and macros.
          </div>
        ) : (
          <AddToCvPanel
            section={adder.section}
            onSelectSection={adder.selectSection}
            rough={adder.rough}
            onUpdateRough={adder.updateRoughField}
            polished={adder.polished}
            busy={adder.busy}
            error={adder.error}
            justAdded={adder.justAdded}
            onPolish={adder.polishEntry}
            onCommit={adder.commitToCv}
            onDiscardPolish={adder.discardPolish}
          />
        )}
      </section>

      {/* Sticky action bar. On mobile it must clear the fixed tab bar, so it
          sits ~4.75rem above the bottom edge instead of the desktop 1rem. */}
      <div className="sticky bottom-[5.25rem] z-10 -mx-5 flex flex-wrap items-center gap-2 border-y border-type-strong/15 bg-stock/95 px-5 py-3 shadow-[0_-2px_18px_-6px_rgba(0,0,0,0.25)] backdrop-blur-md sm:-mx-8 sm:gap-3 sm:px-8 md:bottom-4 lg:-mx-12 lg:px-12">
        <button
          onClick={build}
          disabled={busy !== null || !hasAnyInput}
          className="flex-1 bg-type-strong px-6 py-2.5 text-sm font-medium text-stock transition-colors hover:bg-marigold-deep disabled:cursor-not-allowed disabled:bg-type-muted disabled:text-stock sm:flex-none"
        >
          {busy === "build"
            ? "Merging…"
            : profile.parsed
              ? "Rebuild profile"
              : "Build profile"}
        </button>
        <button
          onClick={saveInputsOnly}
          disabled={busy !== null}
          className="flex-1 border border-type-strong/20 px-5 py-2.5 text-sm text-type-body transition hover:border-type-strong/35 hover:bg-stock-shade/70 disabled:opacity-40 sm:flex-none"
        >
          Save inputs only
        </button>
        {saved && (
          <span className="w-full text-xs text-sage-ink sm:w-auto">
            Saved to this browser.
          </span>
        )}
        <span className="ml-auto hidden text-xs text-type-muted md:block">
          Profile lives in your browser&apos;s localStorage.
        </span>
      </div>

      <div ref={profileViewRef} />

      {profile.parsed && (
        <section className="mt-12 md:mt-16">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl font-medium sm:text-3xl">
              Merged profile
            </h2>
            <div className="flex items-center gap-2 text-xs text-type-muted">
              <span className="eyebrow text-paper/45">Built from</span>
              {builtSources.map((s) => (
                <SourceBadge key={s} source={s} />
              ))}
            </div>
          </div>
          <ParsedProfileView parsed={profile.parsed} />
        </section>
      )}
    </PageShell>
  );
}
