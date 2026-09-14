import { describe, it, expect } from "vitest";
import {
  mentions,
  claimsDisclaimed,
  generationReport,
} from "@/evals/generation";

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
    expect(out).toContain(
      "| case-a | 98 | 1 | 100% | clean | clean | clean | none |",
    );
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

describe("generationReport — fill against the source ceiling", () => {
  const base = {
    name: "rich",
    ok: true as const,
    ms: 1000,
    atsScore: 100,
    pages: 1,
    iterations: 1,
    chars: 2500,
    budget: 3420,
    fill: 2500 / 3420,
    effectiveFill: 2500 / 3420,
    ceilingBound: false,
    mustIncludeCoverage: 1,
    mustIncludeMissed: [],
    honestyViolations: [],
    placeholderLeaks: [],
    criticalFindings: [],
  };

  // A fixture whose source cannot fill the page: 1059 chars of a 1200 ceiling.
  const sparse = {
    ...base,
    name: "sparse",
    chars: 1059,
    fill: 1059 / 3420,
    effectiveFill: 1059 / 1200,
    sourceCeiling: 1200,
    ceilingBound: true,
  };

  it("shows raw fill for a case the budget binds", () => {
    expect(generationReport([base], "m")).toContain("| 73% |");
  });

  it("shows raw and effective for a ceiling-bound case", () => {
    const out = generationReport([sparse], "m");
    // 31% of budget, but 88% of what the source could support.
    expect(out).toContain("31% (88%)†");
  });

  it("footnotes the dagger only when a ceiling-bound case exists", () => {
    expect(generationReport([sparse], "m")).toContain("† source-ceiling-bound");
    expect(generationReport([base], "m")).not.toContain("† source-ceiling");
  });

  it("means raw fill over MOVABLE cases only, with the count stated", () => {
    // Averaging a ceiling-bound 31% into the headline is what made the old
    // number misleading; the denominator must be visible.
    const out = generationReport([base, sparse], "m");
    expect(out).toContain("73% (1 movable)");
  });

  it("reports effective fill across all cases alongside it", () => {
    const out = generationReport([base, sparse], "m");
    expect(out).toMatch(/eff/);
  });

  it("flags a ceiling-bound case that exceeded its declared ceiling", () => {
    // The signature of fabrication under fill pressure — measured once, and
    // the reason this tripwire exists.
    const fabricating = { ...sparse, chars: 1500, effectiveFill: 1500 / 1200 };
    const out = generationReport([fabricating], "m");
    expect(out).toMatch(/exceeded its declared source ceiling/);
    expect(out).toContain("sparse");
  });

  it("does not flag a ceiling-bound case within tolerance", () => {
    const fine = { ...sparse, chars: 1250, effectiveFill: 1250 / 1200 };
    expect(generationReport([fine], "m")).not.toMatch(/exceeded its declared/);
  });

  it("shows an em dash for movable fill when every case is ceiling-bound", () => {
    expect(generationReport([sparse], "m")).toContain("— (0 movable)");
  });
});

describe("claimsDisclaimed — single-letter skills", () => {
  // The measured false positive: profile-input-kind was reported as claiming
  // "R" on a résumé that never mentions it.
  it("does not fire on a stray capital letter", () => {
    expect(
      claimsDisclaimed("Gregorio R. Pascua — Software Engineer", "R"),
    ).toBe(false);
  });

  it("does not fire on a section letter or bullet glyph", () => {
    expect(claimsDisclaimed("EXPERIENCE R Built a pipeline", "R")).toBe(false);
  });

  it("still catches a real claim in a skills list", () => {
    expect(claimsDisclaimed("Languages: Python, R, SQL and Java", "R")).toBe(
      true,
    );
  });

  it("still catches a real claim stated as prose", () => {
    expect(
      claimsDisclaimed("Used R for statistical modelling of loan data", "R"),
    ).toBe(true);
  });

  it("leaves multi-character keywords on the normal matcher", () => {
    expect(
      claimsDisclaimed(
        "Deployed to Azure Data Services",
        "azure data services",
      ),
    ).toBe(true);
    expect(claimsDisclaimed("Deployed to AWS", "azure data services")).toBe(
      false,
    );
  });

  it("ignores an empty keyword", () => {
    expect(claimsDisclaimed("anything at all", "")).toBe(false);
    expect(claimsDisclaimed("anything at all", "   ")).toBe(false);
  });
});
