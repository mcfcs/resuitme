// Turn the metrics panel's answers into profile metrics.
//
// The panel shows what the honesty gate removed from a draft and lets the
// candidate put it back in their own words: confirm a bullet's claims as
// true, or supply the real figure behind one the model invented. What comes
// out is a ProfileMetric — the candidate's own assertion, which the build
// route treats as part of their material from then on.
//
// Claims are grouped BY BULLET. Measured in the live app: one bullet carried
// "stakeholders", "stakeholder" and "cross-functional", and three figures sat
// in another — six rows for two sentences, each asking the same question.
// One bullet is one question.
//
// Pure so the shape of what gets saved is pinned by tests, not by clicking.

import type { SoftenedClaim, SoftenedKind } from "@/lib/ats/claim-check";
import type { ProfileMetric } from "@/lib/profile";

/** One row's answer. `keep` confirms the bullet; `value` is a real figure. */
export type MetricAnswer = { keep: boolean; value: string };

/** Every softened claim on one bullet, as the panel presents it. */
export type SoftenedGroup = {
  /** Stable key for answers: the bullet as the model first wrote it. */
  key: string;
  bullet: string;
  claims: SoftenedClaim[];
  kinds: SoftenedKind[];
  /** True when every claim on this bullet is an invented figure. */
  figuresOnly: boolean;
  /** The bullet as shipped, when the backstop rewrote it; null when dropped. */
  replacement?: string | null;
  how: SoftenedClaim["how"];
};

/** Group softened claims by the bullet they sit in, in document order. */
export function groupSoftened(softened: SoftenedClaim[]): SoftenedGroup[] {
  const groups = new Map<string, SoftenedGroup>();
  for (const s of softened) {
    const key = tidy(s.bullet);
    if (!key) continue;
    const g = groups.get(key) ?? {
      key,
      bullet: key,
      claims: [],
      kinds: [],
      figuresOnly: true,
      how: s.how,
    };
    // The same figure can be reported once per window it appeared in.
    if (!g.claims.some((c) => c.claim === s.claim && c.kind === s.kind)) {
      g.claims.push(s);
    }
    if (!g.kinds.includes(s.kind)) g.kinds.push(s.kind);
    if (s.kind !== "figure") g.figuresOnly = false;
    // A code rewrite is the most informative "how"; a drop overrides all.
    if (s.replacement !== undefined) g.replacement = s.replacement;
    if (s.how === "dropped" || (s.how === "stripped" && g.how === "rewritten"))
      g.how = s.how;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Collapse whitespace and the seams a deletion leaves. */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\s+(?:by|to|of|at|from)\s*$/i, "")
    .trim();
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The bullet with an invented figure taken out — "Boosted inventory turnover
 * by 15%" becomes "Boosted inventory turnover" — so the invented number never
 * enters the profile, only the candidate's. The preposition that introduced
 * the figure goes with it, the same way the build route's strip removes it.
 */
export function withoutFigure(bullet: string, figure: string): string {
  const forms = [figure, figure.replace(/\\%/g, "%")].map(esc);
  const lead =
    "(?:\\s+(?:by|to|from|of|at)\\s+(?:~|over|about|nearly|up to|roughly|approximately|around|more than|almost)?\\s*)?";
  let out = bullet;
  for (const f of forms) out = out.replace(new RegExp(`${lead}${f}`), " ");
  return tidy(out);
}

/**
 * The claim a metric is about, without any invented figure. A qualitative
 * claim keeps the bullet as written: confirming it means asserting exactly
 * those words.
 */
export function claimTextOf(g: SoftenedGroup): string {
  let text = g.bullet;
  for (const c of g.claims) {
    if (c.kind === "figure") text = withoutFigure(text, c.claim);
  }
  return tidy(text);
}

/** True when this answer says something worth saving. */
export function answerIsSet(
  g: SoftenedGroup,
  a: MetricAnswer | undefined,
): boolean {
  if (!a) return false;
  if (g.figuresOnly) return a.value.trim().length > 0;
  return a.keep || a.value.trim().length > 0;
}

/**
 * Build the metrics the candidate confirmed.
 *
 * A figures-only bullet needs a value; an empty box is "leave it out", the
 * default, which saves nothing. A bullet with a qualitative claim is saved
 * when kept, with a figure if one was typed alongside it. The anchor is the
 * bullet AS SHIPPED, never as the model first wrote it: the metric is
 * rendered into the grounding pool, and an anchor carrying the invented
 * "15%" would ground that very figure on the next build.
 */
export function metricsFromAnswers(
  softened: SoftenedClaim[],
  answers: Record<string, MetricAnswer>,
  now: Date = new Date(),
): ProfileMetric[] {
  const out: ProfileMetric[] = [];
  for (const g of groupSoftened(softened)) {
    const a = answers[g.key];
    if (!answerIsSet(g, a)) continue;
    const claim = claimTextOf(g);
    if (!claim) continue;
    const value = a!.value.trim() || undefined;
    const metric: ProfileMetric = { claim, addedAt: now.toISOString() };
    if (value) metric.value = value;
    if (typeof g.replacement === "string" && tidy(g.replacement) !== claim) {
      metric.anchor = tidy(g.replacement);
    }
    out.push(metric);
  }
  return out;
}

/** Append new metrics to a profile's list, skipping exact repeats. */
export function mergeMetrics(
  existing: ProfileMetric[] | undefined,
  added: ProfileMetric[],
): ProfileMetric[] {
  const out = [...(existing ?? [])];
  for (const m of added) {
    const dup = out.some(
      (e) =>
        e.claim.trim().toLowerCase() === m.claim.trim().toLowerCase() &&
        (e.value ?? "").trim() === (m.value ?? "").trim(),
    );
    if (!dup) out.push(m);
  }
  return out;
}
