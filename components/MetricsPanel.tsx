"use client";

// The opt-in metrics panel, shown AFTER a built résumé and never before it.
//
// The honesty gate has already removed every claim and figure the profile
// does not support, so the résumé above this panel is finished. This is the
// place to put something back in the candidate's own words: confirm a
// bullet's claims as true, or supply the real figure behind one the model
// invented. Nothing here is required, the panel is collapsed by default, and
// it only ever offers back what the model already reached for — it never
// invites a figure for a bullet that had none, which would be the app
// encouraging embellishment.
//
// One bullet is one row, however many claims it carried: the question the
// candidate is being asked is about the sentence, not the word.
//
// Modelled on HonestyPanel: the same per-item rows, the same verdict-button
// vocabulary, the same footer with a count and one CTA.

import type { SoftenedClaim, SoftenedKind } from "@/lib/ats/claim-check";
import {
  answerIsSet,
  groupSoftened,
  type MetricAnswer,
  type SoftenedGroup,
} from "@/lib/metrics";

const KIND_LABEL: Record<SoftenedKind, string> = {
  figure: "figure",
  leadership: "leadership",
  scale: "scale",
  seniority: "seniority",
  duration: "duration",
};

const HOW_LABEL: Record<SoftenedClaim["how"], string> = {
  rewritten: "reworded by the model",
  stripped: "claim removed, bullet kept",
  dropped: "bullet removed",
};

const pretty = (s: string) => s.replace(/\\%/g, "%");

export default function MetricsPanel({
  softened,
  answers,
  setAnswer,
  saveToProfile,
  setSaveToProfile,
  onApply,
  busy,
}: {
  softened: SoftenedClaim[];
  answers: Record<string, MetricAnswer>;
  setAnswer: (key: string, a: MetricAnswer) => void;
  saveToProfile: boolean;
  setSaveToProfile: (v: boolean) => void;
  onApply: () => void;
  busy: boolean;
}) {
  const groups = groupSoftened(softened);
  const answered = groups.filter((g) => answerIsSet(g, answers[g.key])).length;
  const figures = softened.filter((s) => s.kind === "figure").length;
  const claims = softened.length - figures;

  return (
    <details className="mb-12 border border-sage-ink/25 bg-sage-ink/[0.06] md:mb-14">
      <summary className="cursor-pointer select-none p-4 sm:p-6">
        <span className="font-display text-xl font-medium text-type-strong sm:text-2xl">
          Add real metrics?
        </span>
        <span className="ml-2 text-sm text-type-muted">
          optional — your résumé is already complete
        </span>
        <span className="mt-1 block font-mono text-xs tabular-nums text-type-faint">
          {groups.length} {groups.length === 1 ? "bullet" : "bullets"} with
          unsupported material left out
          {claims > 0 && ` · ${claims} ${claims === 1 ? "claim" : "claims"}`}
          {figures > 0 &&
            ` · ${figures} ${figures === 1 ? "figure" : "figures"}`}
        </span>
      </summary>

      <div className="px-4 pb-4 sm:px-6 sm:pb-6">
        <p className="mb-5 max-w-2xl text-sm leading-relaxed text-type-muted">
          The model wrote these, and your profile does not back them up, so they
          were taken out. If any is true, say so — in your words, with your
          numbers — and the résumé is rebuilt once with them. Anything you
          confirm counts as your own material from now on.
        </p>

        <div className="mb-4 space-y-2 sm:space-y-1.5">
          {groups.map((g) => (
            <GroupRow
              key={g.key}
              group={g}
              answer={answers[g.key] ?? { keep: false, value: "" }}
              setAnswer={(a) => setAnswer(g.key, a)}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-type-body">
              <input
                type="checkbox"
                checked={saveToProfile}
                onChange={(e) => setSaveToProfile(e.target.checked)}
                className="h-4 w-4 accent-sage-ink"
              />
              Save to my profile so I&apos;m never asked again
            </label>
            <span className="font-mono text-xs tabular-nums text-type-muted">
              <span className="text-sage-ink">{answered} confirmed</span> ·{" "}
              <span className="text-rust">
                {groups.length - answered} left out
              </span>
            </span>
          </div>
          <button
            onClick={onApply}
            disabled={busy || answered === 0}
            className="w-full bg-sage-ink px-6 py-3 text-sm font-semibold text-stock shadow-[0_2px_18px_-6px_rgba(116,160,94,0.7)] transition hover:bg-sage-ink disabled:opacity-40 sm:w-auto"
          >
            {busy ? "Rebuilding…" : "Apply and rebuild"}
          </button>
        </div>
      </div>
    </details>
  );
}

function GroupRow({
  group: g,
  answer: a,
  setAnswer,
}: {
  group: SoftenedGroup;
  answer: MetricAnswer;
  setAnswer: (a: MetricAnswer) => void;
}) {
  return (
    <div className="border border-type-strong/8 bg-stock-shade/45 px-3 py-2.5 transition-colors hover:border-type-strong/12 sm:px-3.5 sm:py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs uppercase tracking-wide text-type-faint">
          {g.kinds.map((k) => KIND_LABEL[k]).join(" · ")}
          <span className="normal-case tracking-normal">
            {" "}
            · {HOW_LABEL[g.how]}
          </span>
        </span>
        <span className="flex flex-wrap gap-1">
          {g.claims.map((c) => (
            <span
              key={`${c.kind}|${c.claim}`}
              className="border border-rust/30 bg-rust/[0.06] px-1.5 font-mono text-xs text-rust"
            >
              {pretty(c.claim)}
            </span>
          ))}
        </span>
      </div>
      <p className="mt-1 break-words font-mono text-sm text-type-strong">
        {pretty(g.bullet)}
      </p>
      {g.replacement !== undefined && (
        <p className="mt-0.5 text-xs text-type-muted">
          Now reads:{" "}
          {g.replacement === null ? (
            <em>(removed)</em>
          ) : (
            <span className="font-mono">{g.replacement}</span>
          )}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        {!g.figuresOnly && (
          <div className="grid grid-cols-2 gap-1 sm:flex sm:shrink-0">
            <KeepButton
              active={a.keep}
              tone="keep"
              onClick={() => setAnswer({ ...a, keep: true })}
            >
              It&apos;s true — keep it
            </KeepButton>
            <KeepButton
              active={!a.keep}
              tone="drop"
              onClick={() => setAnswer({ ...a, keep: false })}
            >
              Leave it out
            </KeepButton>
          </div>
        )}
        <input
          type="text"
          value={a.value}
          onChange={(e) => setAnswer({ ...a, value: e.target.value })}
          placeholder={
            g.figuresOnly
              ? "Real figure, if you know it (e.g. 12%)"
              : "Add a figure (optional, e.g. 5 people)"
          }
          aria-label={
            g.figuresOnly
              ? "Real figure for this bullet"
              : "Optional figure for this bullet"
          }
          className="min-h-[2.75rem] w-full border border-type-strong/12 bg-stock px-3 text-sm transition-colors placeholder:text-type-faint focus:border-sage-ink/50 focus:ring-1 focus:ring-sage-ink/25 focus-visible:outline-none sm:min-h-0 sm:max-w-xs sm:py-1.5"
        />
      </div>
    </div>
  );
}

function KeepButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "keep" | "drop";
  onClick: () => void;
  children: React.ReactNode;
}) {
  // min-h-[2.75rem] on mobile keeps every target at the 44px accessibility floor.
  const base =
    "flex min-h-[2.75rem] items-center justify-center border px-3 text-center text-xs transition sm:min-h-0 sm:whitespace-nowrap sm:py-1";
  const styles: Record<typeof tone, string> = {
    keep: active
      ? "bg-sage-ink/30 border-sage-ink/60 text-sage-ink"
      : "border-type-strong/12 text-type-muted hover:border-sage-ink/40 hover:text-sage-ink",
    drop: active
      ? "bg-rust/25 border-rust/60 text-rust"
      : "border-type-strong/12 text-type-muted hover:border-rust/40 hover:text-rust",
  };
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${styles[tone]}`}
    >
      {children}
    </button>
  );
}
