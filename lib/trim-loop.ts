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
export type TrimPhase = "build" | "trim" | "render" | "verify";

export type TrimDeps = {
  /** Produce a draft. `cuts` is undefined on the first pass. */
  generate: (cuts?: string[]) => Promise<string>;
  /** Compile and count real pages. Must never throw — see lib/render.ts. */
  checkPages: (latex: string) => Promise<PageCheck>;
  /**
   * Ask the verifier for cuts totalling ~`overBy` chars. Return an empty array
   * when it has nothing useful; the loop then stops rather than spinning.
   */
  requestCuts: (latex: string, chars: number, overBy: number) => Promise<string[]>;
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
