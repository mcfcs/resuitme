import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  analysisContextBlock,
  filterMustInclude,
  honestyBlock,
  mergeHonestSignals,
  type HonestSignals,
} from "@/lib/prompts/context";
import { COMPOSE_TARGET_FRACTION } from "@/lib/latex";
import type { Analysis } from "@/lib/types";

function analysis(over: Partial<Analysis> = {}): Analysis {
  return {
    score: 72,
    verdict: "Solid fit.",
    strengths: ["Python depth"],
    gaps: ["No Kubernetes"],
    suggestions: ["Lead with the pipeline work"],
    must_include: [
      { item: "aCount platform", reason: "Full-stack payments work." },
      { item: "Loan approval model", reason: "PyTorch and imbalanced data." },
    ],
    keyword_coverage: { present: ["python"], missing: [], partial: [] },
    ...over,
  };
}

describe("mergeHonestSignals", () => {
  it("force-marks analyzer-missing keywords as none", () => {
    const m = mergeHonestSignals(undefined, {
      ...analysis(),
      keyword_coverage: { present: [], missing: ["kubernetes"], partial: [] },
    });
    expect(m.perKeyword.kubernetes).toBe("none");
  });

  it("never overrides an explicit user verdict", () => {
    const honest: HonestSignals = { perKeyword: { kubernetes: "have" } };
    const m = mergeHonestSignals(honest, {
      ...analysis(),
      keyword_coverage: { present: [], missing: ["kubernetes"], partial: [] },
    });
    expect(m.perKeyword.kubernetes).toBe("have");
  });

  it("does not mutate the caller's object", () => {
    const honest: HonestSignals = { perKeyword: { go: "have" } };
    mergeHonestSignals(honest, {
      ...analysis(),
      keyword_coverage: { present: [], missing: ["rust"], partial: [] },
    });
    expect(honest.perKeyword).toEqual({ go: "have" });
  });

  it("tolerates no analysis and no honesty input", () => {
    expect(mergeHonestSignals(undefined, undefined)).toEqual({
      perKeyword: {},
    });
  });

  it("preserves free-form notes", () => {
    const m = mergeHonestSignals(
      { perKeyword: {}, notes: "  I used Spark at work.  " },
      undefined,
    );
    expect(m.notes).toBe("  I used Spark at work.  ");
  });
});

describe("filterMustInclude", () => {
  it("keeps every pick when nothing is disclaimed", () => {
    const picks = analysis().must_include;
    expect(filterMustInclude(picks, {})).toEqual(picks);
  });

  it("drops a pick naming a disclaimed keyword", () => {
    const picks = [
      { item: "Kubernetes migration", reason: "Ran the cluster." },
      { item: "aCount platform", reason: "Payments work." },
    ];
    const out = filterMustInclude(picks, { kubernetes: "none" });
    expect(out).toHaveLength(1);
    expect(out[0].item).toBe("aCount platform");
  });

  it("drops a pick whose REASON names a disclaimed keyword", () => {
    // The contradiction is just as real when the keyword is in the rationale.
    const picks = [{ item: "Platform work", reason: "Shows Terraform depth." }];
    expect(filterMustInclude(picks, { terraform: "none" })).toEqual([]);
  });

  it("keeps picks for keywords marked have or partial", () => {
    const picks = [{ item: "Kubernetes migration", reason: "Ran it." }];
    expect(filterMustInclude(picks, { kubernetes: "have" })).toHaveLength(1);
    expect(filterMustInclude(picks, { kubernetes: "partial" })).toHaveLength(1);
  });

  it("matches on word boundaries, not bare substrings", () => {
    // "Go" must not match "Django" — that would silently drop a valid pick.
    const picks = [{ item: "Django service", reason: "Backend work." }];
    expect(filterMustInclude(picks, { go: "none" })).toHaveLength(1);
  });

  it("still matches punctuated keywords like CI/CD", () => {
    const picks = [{ item: "CI/CD pipeline", reason: "GitHub Actions." }];
    expect(filterMustInclude(picks, { "ci/cd": "none" })).toEqual([]);
  });

  it("is case-insensitive", () => {
    const picks = [{ item: "Kubernetes Migration", reason: "x" }];
    expect(filterMustInclude(picks, { KUBERNETES: "none" })).toEqual([]);
  });

  it("returns an empty array for undefined or empty picks", () => {
    expect(filterMustInclude(undefined, { a: "none" })).toEqual([]);
    expect(filterMustInclude([], { a: "none" })).toEqual([]);
  });
});

describe("analysisContextBlock", () => {
  it("returns empty string with no analysis", () => {
    expect(analysisContextBlock(undefined, [])).toBe("");
  });

  it("includes the core analyzer signals", () => {
    const out = analysisContextBlock(analysis(), []);
    expect(out).toContain("Score: 72/100");
    expect(out).toContain("Solid fit.");
    expect(out).toContain("No Kubernetes");
  });

  it("renders MUST INCLUDE picks ranked and numbered", () => {
    const out = analysisContextBlock(analysis(), analysis().must_include);
    expect(out).toContain("=== MUST INCLUDE");
    expect(out).toContain("1. aCount platform — Full-stack payments work.");
    expect(out).toContain("2. Loan approval model");
  });

  it("pins picks to score 10 and defers to CUTS_TO_APPLY", () => {
    // Without the cuts carve-out, must_include and the trim loop deadlock.
    const out = analysisContextBlock(analysis(), analysis().must_include);
    expect(out).toContain("score 10");
    expect(out).toContain("CUTS_TO_APPLY");
  });

  it("omits the MUST INCLUDE section entirely when no picks survive", () => {
    const out = analysisContextBlock(analysis(), []);
    expect(out).not.toContain("MUST INCLUDE");
  });
});

describe("honestyBlock", () => {
  it("returns empty string when nothing is known", () => {
    expect(honestyBlock({ perKeyword: {} })).toBe("");
  });

  it("groups keywords by verdict", () => {
    const out = honestyBlock({
      perKeyword: { python: "have", aws: "partial", go: "none" },
    });
    expect(out).toMatch(/HAS \(safe to emphasize\): python/);
    expect(out).toMatch(/PARTIAL\/limited experience with[^\n]*aws/);
    expect(out).toMatch(/DOES NOT HAVE[^\n]*go/);
  });

  it("marks empty buckets explicitly rather than leaving a blank", () => {
    const out = honestyBlock({ perKeyword: { go: "none" } });
    expect(out).toContain("(none specified)");
  });

  it("includes trimmed candidate notes when present", () => {
    const out = honestyBlock({
      perKeyword: { go: "none" },
      notes: "  I have shipped Rust.  ",
    });
    expect(out).toContain("I have shipped Rust.");
  });
});

describe("COMPOSE_TARGET_FRACTION matches the prompts", () => {
  // The routes interpolate this constant; the prompts state the percentage in
  // prose. If they drift, the model is told two different targets.
  const pct = Math.round(COMPOSE_TARGET_FRACTION * 100);

  for (const name of ["build", "tailor"]) {
    it(`lib/prompts/${name}.ts states ~${pct}%`, () => {
      const src = readFileSync(
        fileURLToPath(new URL(`../lib/prompts/${name}.ts`, import.meta.url)),
        "utf8",
      );
      expect(src).toContain(`TARGET ~${pct}% of the budget`);
    });
  }
});
