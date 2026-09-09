import { describe, it, expect } from "vitest";
import { mentions, generationReport } from "@/evals/generation";

describe("mentions — word-boundary matching", () => {
  it("matches an exact term", () => {
    expect(mentions("Built CI/CD pipelines", "ci/cd")).toBe(true);
  });

  it("does not match a term buried inside a longer word", () => {
    // Measured false positives that made an honest run look like a breach.
    expect(mentions("Django backend service", "go")).toBe(false);
    expect(mentions("Deployed to Google Cloud Run", "go")).toBe(false);
    expect(mentions("ongoing maintenance work", "go")).toBe(false);
  });

  it("matches the term when it does stand alone", () => {
    expect(mentions("Wrote services in Go and Python", "go")).toBe(true);
  });

  it("matches a multi-word pick by its distinctive words", () => {
    const output = "aCount platform automating sneaker resale accounting";
    expect(mentions(output, "aCount: Sneaker Resale Accounting Platform")).toBe(
      true,
    );
  });

  it("does not match an unrelated multi-word pick", () => {
    expect(
      mentions(
        "Crossword generator with Tagalog support",
        "Bank Loan Approval Model",
      ),
    ).toBe(false);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(mentions("Used PYTORCH heavily", "pytorch")).toBe(true);
    expect(mentions("Scikit-learn models", "scikit learn")).toBe(true);
  });

  it("returns false for an empty needle", () => {
    expect(mentions("anything", "")).toBe(false);
  });
});

describe("generationReport", () => {
  const base = {
    name: "case-a",
    ok: true as const,
    ms: 1000,
    atsScore: 98,
    pages: 1,
    iterations: 1,
    chars: 3200,
    budget: 3420,
    mustIncludeCoverage: 1,
    mustIncludeMissed: [],
    honestyViolations: [],
    placeholderLeaks: [],
    criticalFindings: [],
  };

  it("renders a markdown table with a mean row", () => {
    const out = generationReport([base], "test-model");
    expect(out).toContain("| Case | ATS | Pages |");
    expect(out).toContain("| case-a | 98 | 1 | 100% | clean | none |");
    expect(out).toContain("**mean**");
  });

  it("bolds honesty violations so they cannot be skimmed past", () => {
    const out = generationReport(
      [{ ...base, honestyViolations: ["kubernetes"] }],
      "m",
    );
    expect(out).toContain("**kubernetes**");
  });

  it("counts one-page results in the mean row", () => {
    const out = generationReport([base, { ...base, name: "b", pages: 2 }], "m");
    expect(out).toContain("1/2 at 1pp");
  });

  it("marks a failed case as an error rather than dropping it", () => {
    const out = generationReport(
      [{ name: "boom", ok: false, ms: 5, error: "nope" }],
      "m",
    );
    expect(out).toContain("| boom |");
    expect(out).toContain("ERROR");
  });
});
