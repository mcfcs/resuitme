"use client";

export type HonestVerdict = "have" | "partial" | "none";

/**
 * The honesty gate shown between analysis and generation.
 *
 * Mobile layout note: the keyword and its three verdict buttons cannot share a
 * row at 375px — the buttons either overflow or shrink below a usable tap
 * target. So on small screens the keyword gets its own line and the verdicts
 * become a full-width 3-column grid with 44px-tall targets; the single-row
 * layout returns at sm.
 */
export default function HonestyPanel({
  missing,
  honest,
  setVerdict,
  setAllVerdicts,
  honestNotes,
  setHonestNotes,
  onContinue,
  busy,
  ctaLabel,
  /** "your résumé doesn't mention" vs "your profile doesn't cover". */
  sourceNoun,
  outputNoun,
}: {
  missing: string[];
  honest: Record<string, HonestVerdict>;
  setVerdict: (k: string, v: HonestVerdict) => void;
  setAllVerdicts: (v: HonestVerdict) => void;
  honestNotes: string;
  setHonestNotes: (s: string) => void;
  onContinue: () => void;
  busy: boolean;
  ctaLabel: string;
  sourceNoun: string;
  outputNoun: string;
}) {
  const counts = { have: 0, partial: 0, none: 0 };
  for (const v of Object.values(honest)) counts[v]++;

  return (
    <div className="border border-sage-ink/25 bg-sage-ink/[0.06] p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-xl font-medium text-type-strong sm:text-2xl">
            Be honest about these gaps
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-type-muted">
            For each keyword the JD wants but {sourceNoun}, tell us the truth.
            The {outputNoun} will{" "}
            <em className="font-display text-type-strong">never</em> claim you
            have something you marked as &quot;I don&apos;t.&quot;
          </p>
        </div>
        <div className="flex w-full gap-1 sm:w-auto sm:shrink-0">
          <button
            onClick={() => setAllVerdicts("have")}
            className="flex-1 border border-sage-ink/30 px-2 py-2 text-xs text-sage-ink hover:bg-sage-ink/10 sm:flex-none sm:py-1"
          >
            All: have
          </button>
          <button
            onClick={() => setAllVerdicts("partial")}
            className="flex-1 border border-yellow-500/30 px-2 py-2 text-xs text-marigold-deep hover:bg-marigold/10 sm:flex-none sm:py-1"
          >
            All: partial
          </button>
          <button
            onClick={() => setAllVerdicts("none")}
            className="flex-1 border border-rust/30 px-2 py-2 text-xs text-rust hover:bg-rust/[0.07] sm:flex-none sm:py-1"
          >
            All: none
          </button>
        </div>
      </div>

      <div className="mb-4 space-y-2 sm:space-y-1.5">
        {missing.map((kw) => {
          const v = honest[kw] ?? "partial";
          return (
            <div
              key={kw}
              className="border border-type-strong/8 bg-stock-shade/45 px-3 py-2.5 transition-colors hover:border-type-strong/12 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:px-3.5 sm:py-2"
            >
              <span className="block break-words font-mono text-sm text-type-strong sm:truncate">
                {kw}
              </span>
              <div className="mt-2 grid grid-cols-3 gap-1 sm:mt-0 sm:flex sm:shrink-0">
                <VerdictButton
                  active={v === "have"}
                  tone="have"
                  onClick={() => setVerdict(kw, "have")}
                >
                  I have this
                </VerdictButton>
                <VerdictButton
                  active={v === "partial"}
                  tone="partial"
                  onClick={() => setVerdict(kw, "partial")}
                >
                  Partial
                </VerdictButton>
                <VerdictButton
                  active={v === "none"}
                  tone="none"
                  onClick={() => setVerdict(kw, "none")}
                >
                  I don&apos;t
                </VerdictButton>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-type-strong">
          Notes about your experience (optional)
        </label>
        <textarea
          value={honestNotes}
          onChange={(e) => setHonestNotes(e.target.value)}
          placeholder={`e.g. "I've used Postgres heavily but never DynamoDB" or "Familiar with Kubernetes concepts, never deployed one in production"`}
          className="h-24 w-full resize-y border border-type-strong/12 bg-stock-shade/45 px-3.5 py-2.5 text-sm transition-colors placeholder:text-type-faint focus:border-marigold/50 focus-visible:outline-none focus:ring-1 focus:ring-marigold/25"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="font-mono text-xs tabular-nums text-type-muted">
          <span className="text-sage-ink">{counts.have} have</span> ·{" "}
          <span className="text-marigold-deep">{counts.partial} partial</span> ·{" "}
          <span className="text-rust">{counts.none} skip</span>
        </div>
        <button
          onClick={onContinue}
          disabled={busy}
          className="w-full bg-sage-ink px-6 py-3 text-sm font-semibold text-stock shadow-[0_2px_18px_-6px_rgba(116,160,94,0.7)] transition hover:bg-sage-ink disabled:opacity-40 sm:w-auto"
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

function VerdictButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "have" | "partial" | "none";
  onClick: () => void;
  children: React.ReactNode;
}) {
  // min-h-[2.75rem] on mobile keeps every target at the 44px accessibility floor.
  const base =
    "flex min-h-[2.75rem] items-center justify-center border px-2 text-center text-xs transition sm:min-h-0 sm:whitespace-nowrap sm:py-1";
  const styles: Record<typeof tone, string> = {
    have: active
      ? "bg-sage-ink/30 border-sage-ink/60 text-sage-ink"
      : "border-type-strong/12 text-type-muted hover:border-sage-ink/40 hover:text-sage-ink",
    partial: active
      ? "bg-marigold/25 border-yellow-500/60 text-marigold-deep"
      : "border-type-strong/12 text-type-muted hover:border-yellow-500/40 hover:text-marigold-deep",
    none: active
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
