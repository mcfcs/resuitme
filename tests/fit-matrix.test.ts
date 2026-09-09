import { describe, it, expect } from "vitest";
import { isCorrect, fitReport, type FitCase } from "@/evals/fit-matrix";

const mk = (over: Partial<FitCase> = {}): FitCase => ({
  id: "1",
  stratum: "match",
  title: "Software Intern",
  ok: true,
  ms: 1000,
  score: 80,
  domainMatch: "direct",
  seniorityMatch: "below",
  transferableCount: 2,
  disqualifyingCount: 0,
  ...over,
});

describe("isCorrect", () => {
  it("accepts direct or adjacent for an in-field role", () => {
    expect(isCorrect("match", "direct")).toBe(true);
    expect(isCorrect("match", "adjacent")).toBe(true);
  });

  it("rejects unrelated for an in-field role — that is the false alarm", () => {
    expect(isCorrect("match", "unrelated")).toBe(false);
  });

  it("requires unrelated for an out-of-field role", () => {
    expect(isCorrect("mismatch", "unrelated")).toBe(true);
    expect(isCorrect("mismatch", "adjacent")).toBe(false);
    expect(isCorrect("mismatch", "direct")).toBe(false);
  });

  it("declines to judge the genuinely ambiguous strata", () => {
    // Scoring arguable cases as failures would make the number meaningless.
    expect(isCorrect("adjacent", "direct")).toBeNull();
    expect(isCorrect("adjacent", "unrelated")).toBeNull();
    expect(isCorrect("generic", "direct")).toBeNull();
  });

  it("returns null when there is no verdict to judge", () => {
    expect(isCorrect("match", undefined)).toBeNull();
  });
});

describe("fitReport", () => {
  it("counts verdicts per stratum", () => {
    const out = fitReport(
      [
        mk({ stratum: "match", domainMatch: "direct" }),
        mk({ stratum: "match", domainMatch: "adjacent" }),
        mk({ stratum: "mismatch", domainMatch: "unrelated" }),
      ],
      "m",
    );
    expect(out).toMatch(/\| match \| 2 \| 1 \| 1 \| 0 \| 100% \|/);
    expect(out).toMatch(/\| mismatch \| 1 \| 0 \| 0 \| 1 \| 100% \|/);
  });

  it("reports the detection rate on out-of-field roles", () => {
    const out = fitReport(
      [
        mk({ stratum: "mismatch", domainMatch: "unrelated" }),
        mk({ stratum: "mismatch", domainMatch: "adjacent" }),
      ],
      "m",
    );
    expect(out).toMatch(/Mismatch detection\*\*: 50%/);
  });

  it("reports false alarms separately from detection", () => {
    // Both directions matter: a detector that flags everything is useless.
    const out = fitReport(
      [
        mk({ stratum: "match", domainMatch: "unrelated" }),
        mk({ stratum: "match", domainMatch: "direct" }),
      ],
      "m",
    );
    expect(out).toMatch(/False alarms\*\*: 50%/);
  });

  it("shows an em dash rather than NaN when a stratum is absent", () => {
    const out = fitReport([mk({ stratum: "generic" })], "m");
    expect(out).not.toMatch(/NaN/);
    expect(out).toMatch(/Mismatch detection\*\*: —/);
  });

  it("counts errored cases without letting them skew the rates", () => {
    const out = fitReport(
      [
        mk({ stratum: "mismatch", domainMatch: "unrelated" }),
        { ...mk({ stratum: "mismatch" }), ok: false, error: "boom" },
      ],
      "m",
    );
    expect(out).toMatch(/Mismatch detection\*\*: 100%/);
    expect(out).toMatch(/1 case errored/);
  });

  it("reports how often transferable evidence was named", () => {
    const out = fitReport(
      [mk({ transferableCount: 2 }), mk({ transferableCount: 0 })],
      "m",
    );
    expect(out).toMatch(/Transferable evidence\*\* named on 50%/);
  });

  it("handles an entirely empty run", () => {
    const out = fitReport([], "m");
    expect(out).toContain("0 real job descriptions");
    expect(out).not.toMatch(/NaN/);
  });
});
