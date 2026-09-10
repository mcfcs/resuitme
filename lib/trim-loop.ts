// The one-page fitting loop, shared in shape by build and tailor mode.
//
// Extracted from the page components so it can be unit-tested without a
// browser, a model, or a LaTeX compiler: every side effect it needs is passed
// in. See tests/trim-loop.test.ts.
//
// THE RULE THIS ENCODES: a real page count from an actual compile is
// authoritative for "does this fit one page". The visible-char budget is only
// (a) a fallback for when rendering is unavailable and (b) a way to size the
// next cut. Trusting the char heuristic over a successful compile is what
// produced two-page "passing" résumés before.

import { isWithinBudget, MAX_TRIM_PASSES, visibleChars } from "@/lib/latex";
import { cutTarget, type PageCheck } from "@/lib/render";

/** Which slow step is currently running, for the UI's busy indicator. */
export type TrimPhase = "build" | "trim" | "render" | "verify" | "expand";

export type TrimDeps = {
  /**
   * Produce a draft. `cuts` is undefined on the first pass; `additions` is
   * only ever set by the expand phase.
   */
  generate: (cuts?: string[], additions?: string[]) => Promise<string>;
  /** Compile and count real pages. Must never throw — see lib/render.ts. */
  checkPages: (latex: string) => Promise<PageCheck>;
  /**
   * Ask the verifier for cuts totalling ~`overBy` chars. Return an empty array
   * when it has nothing useful; the loop then stops rather than spinning.
   */
  requestCuts: (
    latex: string,
    chars: number,
    overBy: number,
  ) => Promise<string[]>;
  /** Progress callback for the busy indicator. */
  onPhase?: (phase: TrimPhase) => void;
  /** Overridable for tests. */
  maxPasses?: number;
};

export type TrimResult = {
  latex: string;
  chars: number;
  iterations: number;
  cutsApplied: string[];
  pages: number | null;
  fits: boolean;
};

/**
 * Generate, measure, and trim until the draft fits one page or the pass budget
 * runs out. Returns whatever it has when it stops — an over-budget result is
 * surfaced to the user, never thrown.
 */
export async function runTrimLoop(
  budget: number,
  deps: TrimDeps,
): Promise<TrimResult> {
  const maxPasses = deps.maxPasses ?? MAX_TRIM_PASSES;

  let latex = "";
  let chars = 0;
  let iterations = 0;
  let cutsApplied: string[] = [];
  let currentCuts: string[] | undefined = undefined;
  let pages: number | null = null;
  let fits = false;

  while (iterations < maxPasses) {
    deps.onPhase?.(iterations === 0 ? "build" : "trim");
    latex = await deps.generate(currentCuts);
    chars = visibleChars(latex);
    iterations += 1;

    // Authoritative check: compile and count real pages.
    deps.onPhase?.("render");
    const check = await deps.checkPages(latex);
    pages = check.pages;

    if (check.measured && pages !== null) {
      // Ground truth. One page (or zero, degenerate) → done.
      if (pages <= 1) {
        fits = true;
        break;
      }
      // Genuinely over one page — fall through to request cuts.
    } else {
      // Couldn't render/compile — fall back to the char-budget heuristic.
      if (chars <= budget || isWithinBudget(chars, budget, 0.005)) {
        fits = true;
        break;
      }
    }

    // Out of passes — surface what we have.
    if (iterations >= maxPasses) break;

    // Ask the verifier for fresh cuts against THIS latest LaTeX. Size the
    // target from the real overflow when the heuristic underestimated.
    const overBy = cutTarget(pages, chars - budget, budget);
    deps.onPhase?.("verify");
    const cuts = await deps.requestCuts(latex, chars, overBy);
    if (!Array.isArray(cuts) || cuts.length === 0) {
      // Verifier had nothing useful — surface as-is.
      break;
    }
    currentCuts = cuts;
    cutsApplied = [...cutsApplied, ...cuts];
  }

  return { latex, chars, iterations, cutsApplied, pages, fits };
}

// --------------------------------------------------------------- expand ----

/** Land in this fraction of the budget or better. Below it, real material was
 *  left unused and a third of the page is blank. */
export const EXPAND_FLOOR_FRACTION = 0.85;

export type ExpandDeps = {
  /**
   * Ask the planner what REAL material should be added, given the draft is
   * `shortBy` visible chars under the floor. Returns executable instructions,
   * already verified against the candidate's own profile pool. An empty array
   * means "nothing left to add" — a correct answer for a sparse profile.
   */
  requestAdditions: (
    latex: string,
    chars: number,
    shortBy: number,
  ) => Promise<string[]>;
};

export type FitResult = TrimResult & {
  /** 0 when the draft was already in band or the planner declined. */
  expandPasses: number;
  /** True when an expansion was produced but rejected as a regression. */
  expandReverted: boolean;
};

/**
 * Trim to one page, then — only if the result left the page underfilled —
 * make ONE attempt to add real material back.
 *
 * WHY A SEQUENTIAL PASS AND NOT A BIDIRECTIONAL LOOP:
 *
 *  - runTrimLoop's correctness rests on drafts getting monotonically smaller,
 *    and `cutsApplied` (shown in the UI) would become a lie if a later pass
 *    could add material back.
 *  - expand -> 2 pages -> trim -> underfull -> expand is a real cycle in an
 *    interleaved design. Here it cannot occur: the expand phase's only failure
 *    mode is reverting to the already-accepted draft, which is terminal.
 *  - Overflow is a hard failure (a 2-page résumé is broken); underfill is a
 *    soft one (a 74% page is worse, not broken). They deserve asymmetric
 *    machinery — four trim passes, one expand attempt.
 *
 * The accepted draft is known-good on every metric that matters, so reverting
 * to it can never regress. Expanding is upside-only by construction.
 */
export async function runFitLoop(
  budget: number,
  deps: TrimDeps & ExpandDeps,
  opts?: { floorFraction?: number },
): Promise<FitResult> {
  const accepted = await runTrimLoop(budget, deps);
  const base: FitResult = {
    ...accepted,
    expandPasses: 0,
    expandReverted: false,
  };

  // Never expand a draft that is already broken — fix overflow first.
  if (!accepted.fits) return base;

  const floor = Math.round(
    budget * (opts?.floorFraction ?? EXPAND_FLOOR_FRACTION),
  );
  if (accepted.chars >= floor) return base;

  const shortBy = floor - accepted.chars;
  deps.onPhase?.("expand");
  const additions = await deps.requestAdditions(
    accepted.latex,
    accepted.chars,
    shortBy,
  );
  // The planner declining is the correct outcome for a sparse profile, not a
  // failure to work around.
  if (!Array.isArray(additions) || additions.length === 0) return base;

  const candidate = await deps.generate(undefined, additions);
  const candidateChars = visibleChars(candidate);

  deps.onPhase?.("render");
  const check = await deps.checkPages(candidate);

  const stillOnePage = check.measured
    ? check.pages === 1
    : isWithinBudget(candidateChars, budget, 0.005);
  const grew = candidateChars > accepted.chars;
  const underCeiling = candidateChars <= Math.round(budget * 1.005);

  if (stillOnePage && grew && underCeiling) {
    return {
      ...base,
      latex: candidate,
      chars: candidateChars,
      pages: check.measured ? check.pages : accepted.pages,
      expandPasses: 1,
    };
  }

  // Reversion is terminal. Re-trimming an over-expanded draft is the
  // oscillation edge, and would put an unvalidated draft in the output path in
  // exchange for a few points of fill — a bad trade against metrics at 100%.
  return { ...base, expandPasses: 1, expandReverted: true };
}
