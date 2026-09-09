// Shared user-message blocks for the two generation routes (/api/build and
// /api/tailor). Both routes assembled these identically; they live here so the
// two flows cannot drift.
//
// WHAT THESE BLOCKS GUARANTEE:
//
//  - PRIOR ANALYSIS carries the analyzer's prioritization signal, including its
//    MUST INCLUDE picks. Those picks are the analyzer's most actionable output
//    (specific named projects/roles, ranked by impact) and are pinned to the
//    top of the prompts' 0-10 relevance rubric.
//
//  - HONESTY SIGNALS are hard constraints. Keywords the candidate does not have
//    must never appear, even paraphrased.
//
//  - The two must never contradict each other. Analyzer-flagged `missing`
//    keywords are force-set to "none" by both routes, so a must_include pick
//    naming such a keyword would simultaneously order the model to feature and
//    to omit the same thing. filterMustInclude() resolves that in favour of
//    honesty — see its comment.

import type { Analysis, FitVerdict, MustIncludePick } from "@/lib/types";

export type HonestVerdict = "have" | "partial" | "none";
export type HonestSignals = {
  perKeyword: Record<string, HonestVerdict>;
  notes?: string;
};

/**
 * Drop must_include picks that name a keyword the candidate has disclaimed.
 *
 * Honesty wins over prioritization: the honesty contract is the app's core
 * promise, and a pick the model is forbidden to mention is worse than useless —
 * it is a direct contradiction in the prompt, which is exactly the kind of thing
 * that makes a small model produce incoherent output.
 *
 * Matching is word-boundary-ish on a normalized string so "Go" does not match
 * "Django" while "CI/CD" still matches "CI/CD pipeline work".
 */
export function filterMustInclude(
  picks: MustIncludePick[] | undefined,
  perKeyword: Record<string, HonestVerdict>,
  /** Requirements no rewrite can satisfy. Same contradiction, different source. */
  disqualifying: string[] = [],
): MustIncludePick[] {
  if (!picks?.length) return [];
  const disclaimed = [
    ...Object.entries(perKeyword)
      .filter(([, v]) => v === "none")
      .map(([k]) => k),
    ...disqualifying,
  ]
    .map(normalizeKeyword)
    .filter(Boolean);
  if (!disclaimed.length) return picks;

  return picks.filter((p) => {
    const hay = ` ${normalizeKeyword(`${p.item} ${p.reason}`)} `;
    return !disclaimed.some((kw) => hay.includes(` ${kw} `));
  });
}

/** Lowercase, collapse punctuation to spaces, squeeze whitespace. */
function normalizeKeyword(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How to pitch the candidate given the viability verdict.
 *
 * Only rendered when the fit is NOT direct. On a direct match this block is
 * noise; on a weak one it is the difference between a résumé that reframes
 * honestly and one that pretends to a domain fit it does not have.
 */
export function fitStrategyBlock(fit: FitVerdict | undefined): string {
  if (!fit || fit.domain_match === "direct") return "";

  const lines = [
    "",
    "=== FIT REALITY (shape the résumé around this) ===",
    `The candidate's field is ${fit.domain_match.toUpperCase()} to this role.`,
  ];

  if (fit.transferable.length) {
    lines.push(
      "Lead with these, which genuinely carry across the gap:",
      ...fit.transferable.map((t) => `  - ${t}`),
    );
  }

  if (fit.disqualifying.length) {
    lines.push(
      "The candidate does NOT meet these, and no wording can change that.",
      "Never imply otherwise; do not feature them:",
      ...fit.disqualifying.map((d) => `  - ${d}`),
    );
  }

  lines.push(
    fit.domain_match === "unrelated"
      ? "Do NOT imitate the vocabulary of a field the candidate has not worked in. Present their real work plainly and let the transferable parts speak."
      : "Frame existing work in terms the JD's field recognizes, without claiming domain experience the candidate lacks.",
    "",
  );

  return lines.join("\n");
}

/**
 * The analyzer's prioritization signal.
 *
 * `picks` is passed separately (already filtered) rather than read off
 * `analysis.must_include`, so the caller cannot forget to apply the honesty
 * filter.
 */
export function analysisContextBlock(
  analysis: Analysis | undefined,
  picks: MustIncludePick[],
): string {
  if (!analysis) return "";

  const mustInclude = picks.length
    ? `
=== MUST INCLUDE (analyzer's highest-impact picks — ranked) ===
Each item below is relevance score 10. Include every one of them unless a
CUTS_TO_APPLY block explicitly removes it.
${picks.map((p, i) => `${i + 1}. ${p.item} — ${p.reason}`).join("\n")}
`
    : "";

  return `\n=== PRIOR ANALYSIS (for prioritization, not for fabrication) ===
Score: ${analysis.score}/100
Verdict: ${analysis.verdict}
Top gaps: ${analysis.gaps.join("; ")}
Missing keywords: ${analysis.keyword_coverage.missing.join(", ")}
Suggested edits: ${analysis.suggestions.join("; ")}
${mustInclude}`;
}

/**
 * Merge analyzer-flagged missing keywords into the honesty map as hard "none" —
 * but only for keywords the user hasn't already given an explicit verdict for.
 * This treats the analyzer's gap signal as a hard block in the generator rather
 * than a soft suggestion.
 */
export function mergeHonestSignals(
  honest: HonestSignals | undefined,
  analysis: Analysis | undefined,
): HonestSignals {
  const merged: HonestSignals = honest
    ? { ...honest, perKeyword: { ...honest.perKeyword } }
    : { perKeyword: {} };
  if (analysis?.keyword_coverage?.missing) {
    for (const kw of analysis.keyword_coverage.missing) {
      if (!(kw in merged.perKeyword)) {
        merged.perKeyword[kw] = "none";
      }
    }
  }
  return merged;
}

export function honestyBlock(merged: HonestSignals): string {
  const have: string[] = [];
  const partial: string[] = [];
  const none: string[] = [];
  for (const [k, v] of Object.entries(merged.perKeyword)) {
    if (v === "have") have.push(k);
    else if (v === "partial") partial.push(k);
    else if (v === "none") none.push(k);
  }
  if (have.length + partial.length + none.length === 0) return "";

  return `\n=== HONESTY SIGNALS (HARD CONSTRAINTS — apply strictly) ===
Skills/keywords the candidate HAS (safe to emphasize): ${have.length ? have.join(", ") : "(none specified)"}
Skills/keywords the candidate has PARTIAL/limited experience with (only mention if evidence exists, never as headline expertise): ${partial.length ? partial.join(", ") : "(none specified)"}
Skills/keywords the candidate DOES NOT HAVE (NEVER include, NEVER paraphrase, omit entirely): ${none.length ? none.join(", ") : "(none specified)"}
${merged.notes?.trim() ? `Candidate's notes about their experience: ${merged.notes.trim()}` : ""}
`;
}
