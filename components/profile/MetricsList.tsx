"use client";

// The figures and claims the candidate confirmed in build mode's metrics
// panel. They ground the honesty gates from then on, so they must be visible
// here — a claim the candidate can no longer stand behind has to be
// removable, or the profile would keep asserting it on every résumé.

import type { ProfileMetric } from "@/lib/profile";

export default function MetricsList({
  metrics,
  onRemove,
}: {
  metrics: ProfileMetric[];
  onRemove: (index: number) => void;
}) {
  if (!metrics.length) return null;
  return (
    <section className="mt-12 md:mt-16">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl font-medium sm:text-3xl">
          Confirmed figures and claims
        </h2>
        <span className="text-xs text-type-muted">
          Added from build mode. Counted as your own material.
        </span>
      </div>
      <ul className="divide-y divide-type-strong/10 border border-type-strong/12 bg-stock-shade/40">
        {metrics.map((m, i) => (
          <li
            key={`${m.claim}|${m.value ?? ""}|${i}`}
            className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3 sm:p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-type-strong">
                {m.claim}
                {m.value && (
                  <span className="ml-2 font-mono text-sage-ink">
                    {m.value}
                  </span>
                )}
              </p>
              {m.anchor && m.anchor !== m.claim && (
                <p className="mt-0.5 text-xs text-type-muted">
                  from: <span className="font-mono">{m.anchor}</span>
                </p>
              )}
            </div>
            <button
              onClick={() => onRemove(i)}
              className="min-h-[2.75rem] border border-rust/30 px-3 text-xs text-rust transition hover:bg-rust/[0.07] sm:min-h-0 sm:py-1"
              aria-label={`Remove "${m.claim}"`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
