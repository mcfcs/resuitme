import { describe, it, expect } from "vitest";
import { stripUngroundedNumbers } from "@/lib/ats/number-check";

/** The e-commerce profile behind the measured 15%/30% fabrication. */
const PROFILE = [
  "Independent E-commerce Operator (Retail), Self-Employed.",
  "Developed demand-based dynamic pricing strategies to maximize margins",
  "and inventory turnover. Achieved 0.9514 recall. Contact +63 999-106-2601.",
].join(" ");

function doc(...lines: string[]): string {
  return ["\\begin{document}", ...lines, "\\end{document}"].join("\n");
}

describe("stripUngroundedNumbers", () => {
  it("leaves a grounded draft untouched", () => {
    const latex = doc("\\resumeItem{Achieved 0.9514 recall on loan approval}");
    expect(stripUngroundedNumbers(latex, PROFILE)).toEqual({
      latex,
      stripped: [],
      residual: [],
    });
  });

  it("removes 'by N%' with its preposition", () => {
    const { latex, stripped } = stripUngroundedNumbers(
      doc("\\resumeItem{Boosted inventory turnover by 15\\% across markets}"),
      PROFILE,
    );
    expect(latex).toContain("{Boosted inventory turnover across markets}");
    expect(stripped.map((c) => c.raw)).toEqual(["15\\%"]);
  });

  it("removes a qualified percentage: 'by over 30%'", () => {
    const { latex } = stripUngroundedNumbers(
      doc("\\resumeItem{Cut manual audit time by over 30\\%.}"),
      PROFILE,
    );
    expect(latex).toContain("{Cut manual audit time.}");
  });

  it("removes a percentage in front of its noun", () => {
    const { latex } = stripUngroundedNumbers(
      doc("\\resumeItem{Delivered a 30\\% reduction in audit time}"),
      PROFILE,
    );
    expect(latex).toContain("{Delivered a reduction in audit time}");
  });

  it("removes both ends of a from–to pair", () => {
    // Not 95%: the profile's "0.9514 recall" grounds that one legitimately
    // through the precision-drop rule, and it must stay.
    const { latex } = stripUngroundedNumbers(
      doc("\\resumeItem{Raised accuracy from 40\\% to 85\\% on the test set}"),
      PROFILE,
    );
    expect(latex).toContain("{Raised accuracy on the test set}");
  });

  it("keeps a figure the precision-drop rule grounds", () => {
    const latex = doc("\\resumeItem{Raised recall to 95\\% on the test set}");
    expect(stripUngroundedNumbers(latex, PROFILE).latex).toBe(latex);
  });

  it("removes an invented phone number and its separator", () => {
    // Measured: an invented header phone survived the model's retry. A
    // recruiter will dial it, so it can never ship.
    const { latex, stripped } = stripUngroundedNumbers(
      doc(
        "\\small +1 555-123-4567 $|$ \\href{mailto:a@b.c}{a@b.c} $|$ linkedin.com/in/x",
      ),
      PROFILE,
    );
    expect(latex).toContain("\\small \\href{mailto:a@b.c}{a@b.c} $|$ linkedin");
    expect(latex).not.toContain("555");
    expect(stripped.map((c) => c.raw)).toEqual(["+1 555-123-4567"]);
  });

  it("takes the separator before a phone at the end of the header", () => {
    const { latex } = stripUngroundedNumbers(
      doc("\\small a@b.c $|$ +1 555-123-4567"),
      PROFILE,
    );
    expect(latex).toContain("\\small a@b.c\n");
  });

  it("keeps the candidate's real phone", () => {
    const latex = doc("\\small +63 999 106 2601 $|$ a@b.c");
    expect(stripUngroundedNumbers(latex, PROFILE).latex).toBe(latex);
  });

  it("leaves a figure no rule fits, and reports it as residual", () => {
    // "10+ lifecycle states" is a count with no safe deletion; mangling it
    // would be a new fabrication, so it stays and is reported.
    const latex = doc(
      "\\resumeItem{Tracked orders across 10+ lifecycle states}",
    );
    const r = stripUngroundedNumbers(latex, PROFILE);
    expect(r.latex).toBe(latex);
    expect(r.stripped).toEqual([]);
    expect(r.residual.map((c) => c.raw)).toEqual(["10"]);
  });

  it("handles several figures in one draft without disturbing offsets", () => {
    const { latex, stripped } = stripUngroundedNumbers(
      doc(
        "\\resumeItem{Boosted turnover by 15\\%}",
        "\\resumeItem{Kept 0.9514 recall}",
        "\\resumeItem{Cut audit time by 30\\%}",
      ),
      PROFILE,
    );
    expect(latex).toContain("{Boosted turnover}");
    expect(latex).toContain("{Kept 0.9514 recall}");
    expect(latex).toContain("{Cut audit time}");
    expect(stripped.map((c) => c.raw)).toEqual(["15\\%", "30\\%"]);
  });
});
