"use client";

// Profile page — the user's source of truth.
//
// This component is now composition only. Data and state logic live in
// app/profile/hooks/, and every presentational chunk lives in
// components/profile/.

import SiteNav from "@/components/SiteNav";
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
    hasAnyInput,
    builtSources,
  } = useProfileStorage();

  const adder = useCvAdder({ profile, setProfile });

  if (!hydrated) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-10 px-safe pb-tabbar sm:px-6">
        <div className="text-sm text-paper/40">Loading…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 px-safe pb-tabbar sm:px-6 md:py-12">
      <SiteNav
        trailing={
          <>
            {profile.updatedAt && (
              <span className="hidden text-xs tabular-nums text-paper/40 lg:inline">
                Last saved {new Date(profile.updatedAt).toLocaleString()}
              </span>
            )}
            <button
              onClick={reset}
              className="shrink-0 text-xs text-paper/50 transition hover:text-red-300"
            >
              Clear profile
            </button>
          </>
        }
      />

      <header className="mb-10 max-w-3xl md:mb-14">
        <div
          className="eyebrow mb-4 animate-rise-in text-marigold md:mb-5"
          style={{ animationDelay: "60ms" }}
        >
          Your source of truth
        </div>
        <h1
          className="animate-rise-in font-display text-4xl font-medium leading-[1.02] tracking-tight sm:text-5xl md:text-6xl md:leading-[0.95]"
          style={{ animationDelay: "120ms" }}
        >
          Your <span className="italic text-marigold">profile</span>
        </h1>
        <p
          className="mt-5 max-w-xl animate-rise-in text-base leading-relaxed text-paper/65 md:mt-6 md:text-lg"
          style={{ animationDelay: "220ms" }}
        >
          Paste your base résumé, base CV, and any extra skills. Resuitme merges
          them into one unified profile — deduplicating shared entries and
          combining bullets where the résumé and CV overlap.
        </p>
        {profile.updatedAt && (
          <p className="mt-3 text-xs tabular-nums text-paper/40 lg:hidden">
            Last saved {new Date(profile.updatedAt).toLocaleString()}
          </p>
        )}
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
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

      <section className="mb-10 md:mb-12">
        <h2 className="mb-1.5 font-display text-xl font-medium sm:text-2xl">
          Additional skills &amp; notes
        </h2>
        <p className="mb-4 max-w-2xl text-sm leading-relaxed text-paper/60">
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
          className="w-full text-sm bg-ink-raised/60 border border-paper/10 rounded-md px-4 py-3 h-40 resize-y focus:outline-none focus:border-marigold/60 focus:ring-1 focus:ring-marigold/30 transition-colors placeholder:text-paper/25"
        />
      </section>

      {/* AI-assisted CV addition */}
      <section className="mb-10 md:mb-12">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="eyebrow mb-2 text-marigold">AI-assisted</div>
            <h2 className="font-display text-xl font-medium sm:text-2xl">
              Add to CV with AI
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-paper/60">
              Describe a new experience, project, or other entry. The model
              polishes your input into clean CV-quality content, you review, and
              on confirm it&apos;s inserted into your base CV LaTeX. Your résumé
              stays untouched — the CV is the full source of truth.
            </p>
          </div>
        </div>

        {!profile.baseCvLatex?.trim() ? (
          <div className="rounded-md border border-paper/10 bg-ink-raised/40 p-4 text-sm text-paper/60">
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
      <div className="sticky bottom-[4.75rem] z-10 flex flex-wrap items-center gap-2 rounded-md border border-paper/10 bg-ink/90 px-3 py-3 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)] backdrop-blur-md sm:gap-3 sm:px-4 md:bottom-4">
        <button
          onClick={build}
          disabled={busy !== null || !hasAnyInput}
          className="flex-1 rounded-md bg-marigold px-6 py-2.5 text-sm font-semibold text-ink shadow-[0_2px_18px_-6px_rgba(232,168,56,0.6)] transition hover:bg-marigold-deep disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
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
          className="flex-1 rounded-md border border-paper/15 px-5 py-2.5 text-sm text-paper/80 transition hover:border-paper/30 hover:bg-paper/5 disabled:opacity-40 sm:flex-none"
        >
          Save inputs only
        </button>
        {saved && (
          <span className="w-full text-xs text-sage-300 sm:w-auto">
            Saved to this browser.
          </span>
        )}
        <span className="ml-auto hidden font-display text-xs italic text-paper/40 md:block">
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
            <div className="flex items-center gap-2 text-xs text-paper/60">
              <span className="eyebrow text-paper/45">Built from</span>
              {builtSources.map((s) => (
                <SourceBadge key={s} source={s} />
              ))}
            </div>
          </div>
          <ParsedProfileView parsed={profile.parsed} />
        </section>
      )}
    </main>
  );
}
