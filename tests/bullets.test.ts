import { describe, it, expect } from "vitest";
import { enclosingBullet, bulletTextAt, matchBrace } from "@/lib/ats/bullets";
import { findUngroundedNumbers } from "@/lib/ats/number-check";

const DOC = [
  "\\begin{document}",
  "\\resumeItemListStart",
  "  \\resumeItem{Built the \\textbf{pricing} engine by 15\\% faster}",
  "  \\resumeItem{Kept the lights on}",
  "\\resumeItemListEnd",
  "\\end{document}",
].join("\n");

describe("matchBrace", () => {
  it("matches across nested groups and escaped braces", () => {
    const s = "{a \\textbf{b} \\} c} tail";
    expect(s.slice(0, matchBrace(s, 0))).toBe("{a \\textbf{b} \\} c}");
  });

  it("returns -1 when unbalanced", () => {
    expect(matchBrace("{a {b}", 0)).toBe(-1);
  });
});

describe("enclosingBullet", () => {
  it("finds the \\resumeItem a position sits in, braces matched", () => {
    const at = DOC.indexOf("15");
    const span = enclosingBullet(DOC, at);
    expect(span.isItem).toBe(true);
    expect(DOC.slice(span.outerStart, span.outerEnd)).toBe(
      "\\resumeItem{Built the \\textbf{pricing} engine by 15\\% faster}",
    );
  });

  it("falls back to the line, past a bare \\item marker", () => {
    const s = "\\begin{document}\n  \\item Led the work\n\\end{document}";
    const span = enclosingBullet(s, s.indexOf("Led"));
    expect(span.isItem).toBe(false);
    expect(s.slice(span.innerStart, span.innerEnd)).toBe("Led the work");
  });
});

describe("readableText", () => {
  it("keeps a space between adjacent macro arguments", () => {
    // Measured in the metrics panel: "Founder & Lead DeveloperPhilippines".
    const s =
      "\\begin{document}\n\\resumeSubheading{Founder \\& Lead Developer}{Philippines}\n";
    expect(bulletTextAt(s, s.indexOf("Lead"))).toBe(
      "Founder & Lead Developer Philippines",
    );
  });
});

describe("bulletTextAt", () => {
  it("returns the bullet as the user reads it, commands stripped", () => {
    expect(bulletTextAt(DOC, DOC.indexOf("15"))).toBe(
      "Built the pricing engine by 15% faster",
    );
  });
});

describe("numeric claim context", () => {
  it("is the whole bullet, not a LaTeX window", () => {
    // Measured in the metrics panel: "...18 months.} \resumeItemListEnd
    // \resumeSubhe" where the candidate's sentence should have been.
    const [c] = findUngroundedNumbers(DOC, "nothing here grounds it");
    expect(c.raw).toBe("15\\%");
    expect(c.context).toBe("Built the pricing engine by 15% faster");
    expect(c.context).not.toContain("\\resume");
  });

  it("keeps a window for a figure outside any bullet", () => {
    const header = "\\begin{document}\n\\small +1 555-123-4567 $|$ a@b.c\n";
    const [c] = findUngroundedNumbers(header, "no phone");
    expect(c.context).toContain("555-123-4567");
  });
});
