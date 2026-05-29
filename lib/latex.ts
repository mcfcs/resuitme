// Heuristic one-page char budget for a typical 10–11pt LaTeX resume.
// Single-column, standard margins. Used as a hard ceiling when the user's
// original resume is longer than one page.
export const MAX_ONE_PAGE_CHARS = 4500;

// Safety margin baked into the budget we send to the model. The measured
// visibleChars of the template approximates one-page capacity, but real LaTeX
// rendering can overflow on borderline counts. By telling the model the
// budget is 95% of measured, even a small model overshoot stays well under
// real one-page capacity.
export const SAFETY_MARGIN = 0.95;

// Slack tolerance — only skip the trim pass if the overshoot is this small.
// Tight: even ~2-3% overshoot tends to push real LaTeX onto a second page.
export const BUDGET_TOLERANCE = 0.005;

// Maximum number of build/tailor + verify+trim cycles before we give up and
// surface the result as "over budget" so the user can decide what to do.
// Bumped to 4 to give the loop one more shot at converging.
export const MAX_TRIM_PASSES = 4;

/**
 * Extract the rough visible-text content from a LaTeX source, stripping
 * commands, comments, and braces. Used purely for length estimation —
 * not for rendering. Imperfect but consistent: counts text inside
 * \command{text} as visible (e.g., \section{Experience} → "Experience").
 */
export function visibleText(latex: string): string {
  if (!latex) return "";
  let s = latex;

  // Strip line comments (a leading % that isn't escaped).
  s = s.replace(/(?<!\\)%[^\n]*/g, "");

  // Restrict to document body if present.
  const beg = s.indexOf("\\begin{document}");
  if (beg >= 0) s = s.slice(beg + "\\begin{document}".length);
  const end = s.indexOf("\\end{document}");
  if (end >= 0) s = s.slice(0, end);

  // Treat \\ as a soft newline.
  s = s.replace(/\\\\/g, "\n");

  // Strip remaining \command, \command*, and any [optional] arg blocks.
  // Loop a few times to handle adjacent commands (\textbf{\large Title}).
  for (let i = 0; i < 6; i++) {
    s = s.replace(/\\[a-zA-Z@]+\*?(?:\s*\[[^\]]*\])*\s*/g, "");
  }

  // Drop braces (their content stays).
  s = s.replace(/[{}]/g, "");

  // Drop math delimiters.
  s = s.replace(/\$+/g, "");

  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

export function visibleChars(latex: string): number {
  return visibleText(latex).length;
}

export function visibleWords(latex: string): number {
  const t = visibleText(latex);
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * Compute the visible-char budget for a tailored resume given the original.
 * Applies SAFETY_MARGIN so the model has tighter constraints than the actual
 * one-page capacity — even if the model overshoots its target, the real
 * output still fits.
 */
export function computeOnePageBudget(originalLatex: string): {
  budget: number;
  originalChars: number;
  capped: boolean;
} {
  const originalChars = visibleChars(originalLatex);
  const capped = originalChars > MAX_ONE_PAGE_CHARS;
  const targetChars = capped ? MAX_ONE_PAGE_CHARS : originalChars;
  const budget = Math.floor(targetChars * SAFETY_MARGIN);
  return { budget, originalChars, capped };
}

export function isWithinBudget(
  chars: number,
  budget: number,
  tolerance: number = BUDGET_TOLERANCE,
): boolean {
  return chars <= Math.round(budget * (1 + tolerance));
}
