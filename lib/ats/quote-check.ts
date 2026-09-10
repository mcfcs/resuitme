// Verify that a proposed addition is really drawn from the candidate's own
// material, rather than invented to fill space.
//
// This is the mechanism that makes the expand pass safe. A prompt asking the
// model not to fabricate is not enough — measured: adding a "floor" to the
// generation prompt made a fixture with a 17% source ceiling invent a JD
// requirement to satisfy it. So every addition must quote its source, and an
// addition whose quote is not really in the pool is discarded before it can
// reach the generator.
//
// Pure and dependency-free so it is unit-testable without a model.

/**
 * Normalise for comparison.
 *
 * The pool is LaTeX and the model quotes prose, so a literal substring test
 * fails on legitimate quotes: `\resumeItem{Built a thing}` versus "Built a
 * thing". Stripping commands and collapsing punctuation makes the two
 * comparable while still requiring the WORDS to be real.
 */
export function normalizeForQuoteMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\\[a-zA-Z@]+\*?/g, " ") // LaTeX commands
    .replace(/[^a-z0-9+#]+/g, " ") // punctuation, braces, accents
    .replace(/\s+/g, " ")
    .trim();
}

/** Below this a "quote" is too short to prove anything. */
export const MIN_QUOTE_CHARS = 15;

/**
 * True when `quote` genuinely appears in `pool`.
 *
 * Deliberately strict: a quote that cannot be found is treated as invented.
 * The cost of a false negative is one dropped addition; the cost of a false
 * positive is a fabricated line on someone's résumé.
 */
export function quoteIsGrounded(quote: string, pool: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalizeForQuoteMatch(pool).includes(q);
}

/**
 * Keep only the additions whose sourceQuote is really in the pool.
 *
 * Returns the survivors plus what was dropped, so the route can log it and the
 * eval can count it — a planner that suddenly starts fabricating should be
 * visible, not silently filtered.
 */
export function filterGroundedAdditions<T extends { sourceQuote: string }>(
  additions: T[] | undefined,
  pool: string,
): { grounded: T[]; dropped: T[] } {
  if (!additions?.length) return { grounded: [], dropped: [] };
  const grounded: T[] = [];
  const dropped: T[] = [];
  for (const a of additions) {
    (quoteIsGrounded(a.sourceQuote ?? "", pool) ? grounded : dropped).push(a);
  }
  return { grounded, dropped };
}
