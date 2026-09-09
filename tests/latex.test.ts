import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  visibleText,
  visibleChars,
  visibleWords,
  computeOnePageBudget,
  computeBuildBudget,
  isWithinBudget,
  MAX_ONE_PAGE_CHARS,
  MIN_ONE_PAGE_CHARS,
  TARGET_ONE_PAGE_CHARS,
  SAFETY_MARGIN,
  BUDGET_TOLERANCE,
} from "@/lib/latex";

const SAMPLE = readFileSync(
  fileURLToPath(new URL("../sampleresume.tex", import.meta.url)),
  "utf8",
);

/** Wrap body text in a minimal document so tests exercise the body-only path. */
function doc(body: string): string {
  return `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

describe("visibleText", () => {
  it("returns empty string for empty input", () => {
    expect(visibleText("")).toBe("");
  });

  it("keeps the argument text of a command", () => {
    expect(visibleText(doc("\\section{Experience}"))).toBe("Experience");
  });

  it("strips an unescaped % comment to end of line", () => {
    expect(visibleText(doc("Alpha % hidden note\nBravo"))).toBe("Alpha Bravo");
  });

  it("keeps an escaped \\% as visible content", () => {
    // The percent is escaped, so it is real rendered text, not a comment —
    // the crucial part is that the rest of the line survives instead of being
    // eaten as a comment. The escaping backslash is left in place; it costs
    // one char against the budget, which only makes the estimate conservative.
    const out = visibleText(doc("Cut costs by 40\\% year over year"));
    expect(out).toContain("year over year");
    expect(out).toBe("Cut costs by 40\\% year over year");
  });

  it("distinguishes an escaped %% from a real comment on the same line", () => {
    // Escaped percent stays; the later unescaped one starts a comment.
    expect(visibleText(doc("Up 40\\% overall % internal note"))).toBe(
      "Up 40\\% overall",
    );
  });

  it("drops the URL of \\href but keeps the anchor", () => {
    const out = visibleText(doc("\\href{https://example.com/a/b}{My Site}"));
    expect(out).toBe("My Site");
    expect(out).not.toContain("example.com");
  });

  it("keeps the URL of \\url, where the url IS the rendered text", () => {
    expect(visibleText(doc("\\url{example.com/me}"))).toContain(
      "example.com/me",
    );
  });

  it("unwraps nested commands like \\textbf{\\large Title}", () => {
    expect(visibleText(doc("\\textbf{\\large Title}"))).toBe("Title");
  });

  it("unwraps deeply nested commands", () => {
    expect(visibleText(doc("\\textbf{\\emph{\\large Deep Title}}"))).toBe(
      "Deep Title",
    );
  });

  it("treats a double backslash as a soft newline rather than joining words", () => {
    expect(visibleText(doc("Line one\\\\Line two"))).toBe("Line one Line two");
  });

  it("ignores content outside \\begin{document}", () => {
    const latex = `\\documentclass{article}
\\usepackage{PREAMBLEONLYTOKEN}
\\begin{document}
Body text
\\end{document}
TRAILINGTOKEN`;
    const out = visibleText(latex);
    expect(out).toBe("Body text");
    expect(out).not.toContain("PREAMBLEONLYTOKEN");
    expect(out).not.toContain("TRAILINGTOKEN");
  });

  it("counts the whole source when there is no document environment", () => {
    expect(visibleText("Just plain text")).toBe("Just plain text");
  });

  it("strips math delimiters but keeps the math text", () => {
    expect(visibleText(doc("Achieved $O(n)$ lookup"))).toBe(
      "Achieved O(n) lookup",
    );
  });

  it("collapses runs of whitespace", () => {
    expect(visibleText(doc("A    B\n\n\nC"))).toBe("A B C");
  });

  it("drops a comment-only line entirely", () => {
    expect(visibleText(doc("% just a note\nReal"))).toBe("Real");
  });

  it("keeps bullet prose while dropping the itemize scaffolding", () => {
    const out = visibleText(
      doc(
        "\\begin{itemize}\n\\item Built a thing\n\\item Shipped it\n\\end{itemize}",
      ),
    );
    expect(out).toContain("Built a thing");
    expect(out).toContain("Shipped it");
  });
});

describe("visibleChars / visibleWords", () => {
  it("agree with visibleText", () => {
    const latex = doc("\\textbf{Hello} world");
    expect(visibleChars(latex)).toBe(visibleText(latex).length);
    expect(visibleWords(latex)).toBe(2);
  });

  it("returns 0 for empty input", () => {
    expect(visibleWords("")).toBe(0);
    expect(visibleChars("")).toBe(0);
  });
});

describe("sampleresume.tex fixture", () => {
  it("lands in a sane one-page range", () => {
    const chars = visibleChars(SAMPLE);
    // A real, full one-page résumé measures ~3,500 visible chars per the
    // calibration note on MIN_ONE_PAGE_CHARS. Assert it is a plausible full
    // page: above the starvation floor and below the hard one-page ceiling.
    expect(chars).toBeGreaterThan(MIN_ONE_PAGE_CHARS);
    expect(chars).toBeLessThan(MAX_ONE_PAGE_CHARS);
  });

  it("does not leak preamble package names into visible text", () => {
    const text = visibleText(SAMPLE);
    expect(text).not.toContain("usepackage");
    expect(text).not.toContain("documentclass");
    expect(text).not.toContain("titleformat");
  });

  it("does not leak href URLs into visible text", () => {
    expect(visibleText(SAMPLE)).not.toContain("https://");
  });

  it("retains real résumé prose", () => {
    const text = visibleText(SAMPLE);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/Experience|Education|Projects|Skills/);
  });
});

describe("computeOnePageBudget", () => {
  it("applies the safety margin to a mid-range résumé", () => {
    const body = "x".repeat(3000);
    const { budget, originalChars, capped } = computeOnePageBudget(doc(body));
    expect(originalChars).toBe(3000);
    expect(capped).toBe(false);
    expect(budget).toBe(Math.floor(3000 * SAFETY_MARGIN));
  });

  it("clamps up to MIN_ONE_PAGE_CHARS for a too-short input", () => {
    const { budget, originalChars, capped } = computeOnePageBudget(doc("tiny"));
    expect(originalChars).toBe(4);
    expect(capped).toBe(false);
    // Starvation guard: budget derives from the floor, not from 4 chars.
    expect(budget).toBe(Math.floor(MIN_ONE_PAGE_CHARS * SAFETY_MARGIN));
  });

  it("caps a too-long input at MAX_ONE_PAGE_CHARS and flags capped", () => {
    const body = "x".repeat(MAX_ONE_PAGE_CHARS + 2000);
    const { budget, originalChars, capped } = computeOnePageBudget(doc(body));
    expect(originalChars).toBe(MAX_ONE_PAGE_CHARS + 2000);
    expect(capped).toBe(true);
    expect(budget).toBe(Math.floor(MAX_ONE_PAGE_CHARS * SAFETY_MARGIN));
  });

  it("does not flag capped exactly at the ceiling", () => {
    const { capped } = computeOnePageBudget(
      doc("x".repeat(MAX_ONE_PAGE_CHARS)),
    );
    expect(capped).toBe(false);
  });

  it("always returns a budget strictly below the measured length", () => {
    const { budget, originalChars } = computeOnePageBudget(
      doc("x".repeat(4000)),
    );
    expect(budget).toBeLessThan(originalChars);
  });

  it("handles empty input without producing a zero budget", () => {
    const { budget } = computeOnePageBudget("");
    expect(budget).toBe(Math.floor(MIN_ONE_PAGE_CHARS * SAFETY_MARGIN));
  });
});

describe("computeBuildBudget", () => {
  it("falls back to the calibrated full-page target with no base résumé", () => {
    const { budget, originalChars, capped } = computeBuildBudget(undefined);
    expect(budget).toBe(Math.floor(TARGET_ONE_PAGE_CHARS * SAFETY_MARGIN));
    expect(originalChars).toBe(0);
    expect(capped).toBe(false);
  });

  it("falls back for an empty / whitespace base résumé", () => {
    expect(computeBuildBudget("").budget).toBe(
      Math.floor(TARGET_ONE_PAGE_CHARS * SAFETY_MARGIN),
    );
    expect(computeBuildBudget("   \n  ").budget).toBe(
      Math.floor(TARGET_ONE_PAGE_CHARS * SAFETY_MARGIN),
    );
  });

  it("ignores a trivial placeholder template rather than starving the budget", () => {
    // The layout template's inline content is short placeholder text;
    // anchoring to it would yield a quarter-page budget.
    const placeholder = doc("Your Name \\\\ Placeholder bullet");
    expect(visibleChars(placeholder)).toBeLessThan(MIN_ONE_PAGE_CHARS);
    expect(computeBuildBudget(placeholder).budget).toBe(
      Math.floor(TARGET_ONE_PAGE_CHARS * SAFETY_MARGIN),
    );
  });

  it("anchors to a real base résumé at/above the floor", () => {
    const real = doc("x".repeat(MIN_ONE_PAGE_CHARS + 500));
    expect(computeBuildBudget(real)).toEqual(computeOnePageBudget(real));
  });

  it("anchors to the sample résumé, which is a real document", () => {
    expect(computeBuildBudget(SAMPLE)).toEqual(computeOnePageBudget(SAMPLE));
  });
});

describe("isWithinBudget", () => {
  it("accepts a count under budget", () => {
    expect(isWithinBudget(900, 1000)).toBe(true);
  });

  it("accepts a count exactly at budget", () => {
    expect(isWithinBudget(1000, 1000)).toBe(true);
  });

  it("accepts an overshoot inside the default tolerance", () => {
    // Default tolerance is 0.5%, so 1005 against a 1000 budget still fits.
    expect(isWithinBudget(1005, 1000, BUDGET_TOLERANCE)).toBe(true);
  });

  it("rejects an overshoot beyond the default tolerance", () => {
    expect(isWithinBudget(1006, 1000)).toBe(false);
  });

  it("honours an explicit wider tolerance", () => {
    expect(isWithinBudget(1050, 1000, 0.05)).toBe(true);
    expect(isWithinBudget(1051, 1000, 0.05)).toBe(false);
  });

  it("honours a zero tolerance", () => {
    expect(isWithinBudget(1000, 1000, 0)).toBe(true);
    expect(isWithinBudget(1001, 1000, 0)).toBe(false);
  });
});
