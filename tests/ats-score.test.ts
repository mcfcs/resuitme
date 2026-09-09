import { describe, it, expect } from "vitest";
import {
  groupIntoLines,
  countOrderAnomalies,
  countColumnBreaks,
  scoreExtraction,
  ATS_WEIGHTS,
  type TextItem,
} from "@/lib/ats/score";

const item = (str: string, x: number, y: number): TextItem => ({
  str,
  x,
  y,
  width: str.length * 5,
  height: 10,
});

/** A well-formed single-column page: y decreases monotonically. */
function singleColumn(): TextItem[] {
  return [
    item("Ada Lovelace", 60, 700),
    item("ada@example.com", 60, 686),
    item("+1 555 123 4567", 200, 686),
    item("Summary", 60, 660),
    item(
      "Engineer with production experience building data platforms and web services end to end.",
      60,
      646,
    ),
    item("Education", 60, 620),
    item("Analytical Engine Institute", 60, 606),
    item("1842", 500, 606),
    item("Skills", 60, 580),
    item("Python, SQL, TypeScript, PostgreSQL, Docker, Spark, React", 60, 566),
    item("Experience", 60, 540),
    item(
      "Built and shipped production data pipelines, services and internal tooling across several teams, with measurable reliability improvements.",
      60,
      526,
    ),
    item("Projects", 60, 500),
    item(
      "Designed and delivered a full-stack reporting application used daily by operations staff, including its data model and deployment.",
      60,
      486,
    ),
  ];
}

const textOf = (items: TextItem[]) => items.map((i) => i.str).join(" ");
const facts = (items: TextItem[], over: Partial<{ text: string }> = {}) => ({
  items,
  text: over.text ?? textOf(items),
  pages: 1,
});

describe("groupIntoLines", () => {
  it("groups items sharing a baseline", () => {
    const lines = groupIntoLines([
      item("left", 60, 600),
      item("right", 500, 600),
      item("next", 60, 580),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(2);
  });

  it("tolerates small baseline jitter", () => {
    const lines = groupIntoLines([item("a", 60, 600), item("b", 200, 602)]);
    expect(lines).toHaveLength(1);
  });

  it("separates lines beyond the tolerance", () => {
    const lines = groupIntoLines([item("a", 60, 600), item("b", 60, 590)]);
    expect(lines).toHaveLength(2);
  });

  it("returns nothing for no items", () => {
    expect(groupIntoLines([])).toEqual([]);
  });
});

describe("countOrderAnomalies", () => {
  it("reports none when every line reads left to right", () => {
    expect(countOrderAnomalies(singleColumn())).toBe(0);
  });

  it("flags a line whose stream order is right-to-left", () => {
    expect(
      countOrderAnomalies([item("right", 500, 600), item("left", 60, 600)]),
    ).toBe(1);
  });

  it("ignores single-item lines", () => {
    expect(countOrderAnomalies([item("solo", 60, 600)])).toBe(0);
  });
});

describe("countColumnBreaks", () => {
  it("reports none for a monotonic single-column flow", () => {
    expect(countColumnBreaks(singleColumn())).toBe(0);
  });

  it("detects the stream jumping back up the page", () => {
    // The two-column signature: column two restarts near the top.
    const items = [
      item("col1 line1", 60, 700),
      item("col1 line2", 60, 600),
      item("col2 line1", 320, 700),
    ];
    expect(countColumnBreaks(items)).toBe(1);
  });

  it("ignores small upward jitter below the threshold", () => {
    const items = [item("a", 60, 600), item("b", 60, 620)];
    expect(countColumnBreaks(items, 40)).toBe(0);
  });

  it("counts each column boundary", () => {
    const items = [
      item("a", 60, 700),
      item("b", 60, 500),
      item("c", 250, 700),
      item("d", 250, 500),
      item("e", 450, 700),
    ];
    expect(countColumnBreaks(items)).toBe(2);
  });
});

describe("scoreExtraction — a clean résumé", () => {
  const result = scoreExtraction(facts(singleColumn()));

  it("scores 100", () => {
    expect(result.score).toBe(100);
  });

  it("passes every check", () => {
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("awards each check its full weight", () => {
    for (const c of result.checks) {
      expect(c.points).toBe(ATS_WEIGHTS[c.id]);
    }
  });

  it("weights sum to 100", () => {
    expect(Object.values(ATS_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("scoreExtraction — glyph integrity", () => {
  it("deducts for a control character in the text", () => {
    // The measured peso bug: ₱ extracted as U+0091.
    const items = singleColumn();
    const bad = scoreExtraction(
      facts(items, { text: `${textOf(items)} PHP53M budget` }),
    );
    const check = bad.checks.find((c) => c.id === "glyph-integrity")!;
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/1 character/);
  });

  it("deducts for a replacement character", () => {
    const items = singleColumn();
    const r = scoreExtraction(
      facts(items, { text: `${textOf(items)} broken�glyph` }),
    );
    expect(r.checks.find((c) => c.id === "glyph-integrity")!.passed).toBe(
      false,
    );
  });

  it("does not deduct for ordinary punctuation", () => {
    const items = singleColumn();
    const r = scoreExtraction(
      facts(items, { text: `${textOf(items)} ran 10–15 trials — twice` }),
    );
    expect(r.checks.find((c) => c.id === "glyph-integrity")!.passed).toBe(true);
  });
});

describe("scoreExtraction — column detection", () => {
  it("zeroes the single-column check on any column break", () => {
    const items = [
      ...singleColumn(),
      item("sidebar top", 400, 700), // jumps back up
    ];
    const check = scoreExtraction(facts(items)).checks.find(
      (c) => c.id === "single-column",
    )!;
    expect(check.points).toBe(0);
    expect(check.detail).toMatch(/jumps back up/);
  });

  it("costs a two-column layout more than any other single defect", () => {
    const clean = scoreExtraction(facts(singleColumn())).score;
    const twoCol = scoreExtraction(
      facts([...singleColumn(), item("sidebar", 400, 700)]),
    ).score;
    expect(clean - twoCol).toBeGreaterThanOrEqual(ATS_WEIGHTS["single-column"]);
  });
});

describe("scoreExtraction — extractability", () => {
  it("fails when almost no text came out", () => {
    const r = scoreExtraction({ items: [], text: "Ada", pages: 1 });
    const check = r.checks.find((c) => c.id === "text-extractable")!;
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/image or use outlined fonts/);
  });

  it("scores near zero for an empty text layer", () => {
    const r = scoreExtraction({ items: [], text: "", pages: 1 });
    expect(r.score).toBeLessThan(25);
  });
});

describe("scoreExtraction — contact and sections", () => {
  it("fails contact when no email survives", () => {
    const items = singleColumn().filter((i) => !i.str.includes("@"));
    const r = scoreExtraction(facts(items));
    expect(r.checks.find((c) => c.id === "contact-parseable")!.passed).toBe(
      false,
    );
  });

  it("partially credits an email with no phone", () => {
    const items = singleColumn().filter((i) => !i.str.startsWith("+1"));
    const check = scoreExtraction(facts(items)).checks.find(
      (c) => c.id === "contact-parseable",
    )!;
    expect(check.points).toBeGreaterThan(0);
    expect(check.passed).toBe(false);
  });

  it("credits recognizable headings", () => {
    const check = scoreExtraction(facts(singleColumn())).checks.find(
      (c) => c.id === "standard-sections",
    )!;
    expect(check.passed).toBe(true);
    expect(check.detail).toMatch(/education/);
  });

  it("deducts when headings are unrecognizable", () => {
    const r = scoreExtraction({
      items: singleColumn(),
      text: "My Journey and Other Musings ".repeat(20),
      pages: 1,
    });
    expect(r.checks.find((c) => c.id === "standard-sections")!.passed).toBe(
      false,
    );
  });
});

describe("scoreExtraction — score bounds", () => {
  it("never exceeds 100 or drops below 0", () => {
    for (const f of [
      facts(singleColumn()),
      { items: [], text: "", pages: 1 },
      facts([...singleColumn(), item("x", 400, 700)]),
    ]) {
      const s = scoreExtraction(f).score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});
