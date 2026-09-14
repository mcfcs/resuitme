import { describe, it, expect } from "vitest";
import {
  stat,
  aggregateRuns,
  aggregatedReport,
  UNRELIABLE_RANGE,
} from "@/evals/aggregate";
import type { GenerationResult } from "@/evals/generation";

function result(
  name: string,
  over: Partial<GenerationResult> = {},
): GenerationResult {
  return {
    name,
    ok: true,
    ms: 1000,
    atsScore: 100,
    pages: 1,
    iterations: 1,
    chars: 2900,
    budget: 3420,
    fill: 2900 / 3420,
    effectiveFill: 2900 / 3420,
    ceilingBound: false,
    mustIncludeCoverage: 1,
    mustIncludeMissed: [],
    honestyViolations: [],
    placeholderLeaks: [],
    criticalFindings: [],
    inventedNumbers: [],
    expandPasses: 0,
    ...over,
  };
}

describe("stat — mean ± largest deviation", () => {
  it("brackets every observed value, even for a skewed sample", () => {
    // The measured swing on identical code: 96, 94, 69. Half the range
    // around the mean would NOT reach the 69 — the low run is the one a
    // reader most needs to be able to recover.
    const s = stat([0.96, 0.94, 0.69])!;
    expect(s.mean).toBeCloseTo(0.8633, 3);
    expect(s.spread).toBeCloseTo(0.1733, 3);
    expect(s.mean - s.spread).toBeLessThanOrEqual(0.69);
    expect(s.mean + s.spread).toBeGreaterThanOrEqual(0.96);
  });

  it("flags a range wider than the reliability threshold", () => {
    expect(stat([0.96, 0.94, 0.69])!.unreliable).toBe(true);
    expect(stat([0.85, 0.88, 0.83])!.unreliable).toBe(false);
  });

  it("treats a range exactly at the threshold as reliable", () => {
    expect(stat([0.8, 0.8 + UNRELIABLE_RANGE])!.unreliable).toBe(false);
  });

  it("has zero spread for a single run and never flags it", () => {
    // One run cannot show variance; the report says "1 run" instead.
    const s = stat([0.72])!;
    expect(s.spread).toBe(0);
    expect(s.unreliable).toBe(false);
    expect(s.n).toBe(1);
  });

  it("returns undefined when there is nothing to summarise", () => {
    expect(stat([])).toBeUndefined();
    expect(stat([Number.NaN])).toBeUndefined();
  });

  it("uses the caller's threshold for a 0-100 metric", () => {
    expect(stat([100, 90, 95], 10)!.unreliable).toBe(false);
    expect(stat([100, 88, 95], 10)!.unreliable).toBe(true);
  });
});

describe("aggregateRuns", () => {
  const runs = [
    [result("a", { fill: 0.96 }), result("b", { fill: 0.5 })],
    [result("a", { fill: 0.94 }), result("b", { fill: 0.52 })],
    [result("a", { fill: 0.69 }), result("b", { fill: 0.51 })],
  ];

  it("produces one row per case across all runs", () => {
    const agg = aggregateRuns(runs);
    expect(agg.map((c) => c.name)).toEqual(["a", "b"]);
    expect(agg[0].runs).toBe(3);
    expect(agg[0].okRuns).toBe(3);
  });

  it("marks the swinging case unreliable and the settled one not", () => {
    const [a, b] = aggregateRuns(runs);
    expect(a.fill!.unreliable).toBe(true);
    expect(b.fill!.unreliable).toBe(false);
  });

  it("counts one-page runs rather than averaging pages", () => {
    const agg = aggregateRuns([
      [result("a", { pages: 1 })],
      [result("a", { pages: 2 })],
      [result("a", { pages: 1 })],
    ]);
    expect(agg[0].onePage).toBe(2);
  });

  it("totals honesty signals instead of averaging them away", () => {
    // One violation in three runs is a real finding, not a 0.33.
    const agg = aggregateRuns([
      [result("a")],
      [result("a", { honestyViolations: ["kubernetes"] })],
      [result("a", { inventedNumbers: ["15\\%", "30\\%"] })],
    ]);
    expect(agg[0].honestyViolations).toBe(1);
    expect(agg[0].inventedNumbers).toBe(2);
  });

  it("keeps an errored run in the row and scores the others", () => {
    const agg = aggregateRuns([
      [result("a", { fill: 0.8 })],
      [{ name: "a", ok: false, ms: 5, error: "compile service down" }],
      [result("a", { fill: 0.82 })],
    ]);
    expect(agg[0].runs).toBe(3);
    expect(agg[0].okRuns).toBe(2);
    expect(agg[0].errors).toEqual(["compile service down"]);
    expect(agg[0].fill!.n).toBe(2);
  });

  it("counts ceiling breaches per run on a ceiling-bound case", () => {
    const sparse = (eff: number) =>
      result("sparse", { ceilingBound: true, effectiveFill: eff });
    const agg = aggregateRuns([[sparse(0.9)], [sparse(1.25)], [sparse(1.05)]]);
    expect(agg[0].ceilingBound).toBe(true);
    expect(agg[0].ceilingBreaches).toBe(1);
  });
});

describe("aggregatedReport", () => {
  const runs = [
    [result("a", { fill: 0.96 }), result("b", { fill: 0.85 })],
    [result("a", { fill: 0.94 }), result("b", { fill: 0.87 })],
    [result("a", { fill: 0.69 }), result("b", { fill: 0.83 })],
  ];

  it("states the run count in the heading", () => {
    expect(aggregatedReport(runs, "m")).toContain("3 runs per case");
  });

  it("prints mean ± spread per case", () => {
    const out = aggregatedReport(runs, "m");
    expect(out).toContain(
      "| b | 100 ±0 | 3/3 | 100% ±0 | 0 | 0 | 0 | 0 | 1.0 | 85% ±2 |",
    );
  });

  it("marks an unsettled number so it cannot be read as precise", () => {
    const out = aggregatedReport(runs, "m");
    expect(out).toMatch(/\| a \| .*86% ±17⚠ \|/);
  });

  it("explains the ± and ⚠ conventions under the table", () => {
    const out = aggregatedReport(runs, "m");
    expect(out).toContain("largest deviation from the mean");
    expect(out).toContain("must not be concluded from");
  });

  it("puts a suite-level ± on the mean row", () => {
    // Per-run suite means: 0.905, 0.905, 0.76 → 86% ±10, and the 14-point
    // range between runs earns the suite mean its own ⚠.
    const out = aggregatedReport(runs, "m");
    expect(out).toMatch(/\*\*mean\*\*.*86% ±10⚠ \(2 movable\)/);
  });

  it("bolds any non-zero honesty count", () => {
    const out = aggregatedReport(
      [[result("a", { honestyViolations: ["docker"] })], [result("a")]],
      "m",
    );
    expect(out).toContain("| **1** |");
    expect(out).toContain("| 1 total |");
  });

  it("shows raw (effective)† for a ceiling-bound case", () => {
    const sparse = result("sparse", {
      ceilingBound: true,
      fill: 0.31,
      effectiveFill: 0.88,
    });
    const out = aggregatedReport([[sparse], [sparse]], "m");
    expect(out).toContain("31% ±0 (88% ±0)†");
    expect(out).toContain("† source-ceiling-bound");
  });

  it("reports how many runs breached the ceiling", () => {
    const sparse = (eff: number) =>
      result("sparse", { ceilingBound: true, fill: 0.4, effectiveFill: eff });
    const out = aggregatedReport([[sparse(0.9)], [sparse(1.3)]], "m");
    expect(out).toContain(
      "exceeded its declared source ceiling in 1 of 2 runs",
    );
  });

  it("notes a partially-errored case next to its name", () => {
    const out = aggregatedReport(
      [[result("a")], [{ name: "a", ok: false, ms: 1, error: "boom" }]],
      "m",
    );
    expect(out).toContain("| a (1/2 ok) |");
    expect(out).toContain("errored in 1 run(s): boom");
  });
});
