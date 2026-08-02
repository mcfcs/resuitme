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
    <div className="rounded-md border border-sage-500/25 bg-sage-500/[0.05] p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow mb-2 text-sage-400">The honesty check</div>
          <h3 className="font-display text-xl font-medium text-paper sm:text-2xl">
            Be honest about these gaps
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-paper/65">
            For each keyword the JD wants but {sourceNoun}, tell us the truth.
            The {outputNoun} will{" "}
            <em className="font-display text-paper/90">never</em> claim you have
            something you marked as &quot;I don&apos;t.&quot;
          </p>
        </div>
        <div className="flex w-full gap-1 sm:w-auto sm:shrink-0">
          <button
            onClick={() => setAllVerdicts("have")}
            className="flex-1 rounded border border-sage-500/30 px-2 py-2 text-xs text-sage-200 hover:bg-sage-500/10 sm:flex-none sm:py-1"
          >
            All: have
          </button>
          <button
            onClick={() => setAllVerdicts("partial")}
            className="flex-1 rounded border border-yellow-500/30 px-2 py-2 text-xs text-yellow-200 hover:bg-yellow-500/10 sm:flex-none sm:py-1"
          >
            All: partial
          </button>
          <button
            onClick={() => setAllVerdicts("none")}
            className="flex-1 rounded border border-red-500/30 px-2 py-2 text-xs text-red-200 hover:bg-red-500/10 sm:flex-none sm:py-1"
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
              className="rounded border border-paper/5 bg-ink/40 px-3 py-2.5 transition-colors hover:border-paper/10 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:px-3.5 sm:py-2"
            >
              <span className="block break-words font-mono text-sm text-paper/90 sm:truncate">
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
        <label className="eyebrow mb-2 block text-paper/50">
          Notes about your experience (optional)
        </label>
        <textarea
          value={honestNotes}
          onChange={(e) => setHonestNotes(e.target.value)}
          placeholder={`e.g. "I've used Postgres heavily but never DynamoDB" or "Familiar with Kubernetes concepts, never deployed one in production"`}
          className="h-24 w-full resize-y rounded-md border border-paper/10 bg-ink/40 px-3.5 py-2.5 text-sm transition-colors placeholder:text-paper/25 focus:border-marigold/50 focus:outline-none focus:ring-1 focus:ring-marigold/25"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="font-mono text-xs tabular-nums text-paper/50">
          <span className="text-sage-300">{counts.have} have</span> ·{" "}
          <span className="text-yellow-200">{counts.partial} partial</span> ·{" "}
          <span className="text-red-300">{counts.none} skip</span>
        </div>
        <button
          onClick={onContinue}
          disabled={busy}
          className="w-full rounded-md bg-sage-500 px-6 py-3 text-sm font-semibold text-ink shadow-[0_2px_18px_-6px_rgba(116,160,94,0.7)] transition hover:bg-sage-400 disabled:opacity-40 sm:w-auto"
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
    "flex min-h-[2.75rem] items-center justify-center rounded border px-2 text-center text-xs transition sm:min-h-0 sm:whitespace-nowrap sm:py-1";
  const styles: Record<typeof tone, string> = {
    have: active
      ? "bg-sage-500/30 border-sage-500/60 text-sage-100"
      : "border-paper/10 text-paper/50 hover:border-sage-500/40 hover:text-sage-200",
    partial: active
      ? "bg-yellow-500/25 border-yellow-500/60 text-yellow-100"
      : "border-paper/10 text-paper/50 hover:border-yellow-500/40 hover:text-yellow-200",
    none: active
      ? "bg-red-500/25 border-red-500/60 text-red-100"
      : "border-paper/10 text-paper/50 hover:border-red-500/40 hover:text-red-200",
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
