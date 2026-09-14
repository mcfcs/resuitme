import { describe, it, expect } from "vitest";
import {
  groupSoftened,
  withoutFigure,
  claimTextOf,
  answerIsSet,
  metricsFromAnswers,
  mergeMetrics,
} from "@/lib/metrics";
import type { SoftenedClaim } from "@/lib/ats/claim-check";

const FIGURE: SoftenedClaim = {
  claim: "15\\%",
  kind: "figure",
  bullet: "Boosted inventory turnover by 15\\% across marketplaces",
  how: "stripped",
};

const LEAD: SoftenedClaim = {
  claim: "Led",
  kind: "leadership",
  bullet: "Led a team to design the pricing dashboard",
  replacement: "Designed the pricing dashboard",
  how: "stripped",
};

const NOW = new Date("2026-09-15T12:00:00Z");

describe("groupSoftened — one bullet, one row", () => {
  it("collapses several claims on one bullet into one group", () => {
    // Measured in the live app: "stakeholders", "stakeholder" and
    // "cross-functional" on one sentence produced three identical rows.
    const b = "Coordinated with stakeholders on cross-functional reviews";
    const groups = groupSoftened([
      { claim: "stakeholders", kind: "seniority", bullet: b, how: "rewritten" },
      { claim: "cross-functional", kind: "scale", bullet: b, how: "rewritten" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].claims.map((c) => c.claim)).toEqual([
      "stakeholders",
      "cross-functional",
    ]);
    expect(groups[0].kinds).toEqual(["seniority", "scale"]);
    expect(groups[0].figuresOnly).toBe(false);
  });

  it("dedupes the same figure reported from two windows", () => {
    const groups = groupSoftened([FIGURE, FIGURE]);
    expect(groups[0].claims).toHaveLength(1);
    expect(groups[0].figuresOnly).toBe(true);
  });

  it("keeps separate bullets separate, in order", () => {
    expect(groupSoftened([LEAD, FIGURE]).map((g) => g.bullet)).toEqual([
      LEAD.bullet,
      FIGURE.bullet,
    ]);
  });

  it("carries the code rewrite and lets a drop win", () => {
    const g = groupSoftened([
      LEAD,
      {
        ...LEAD,
        claim: "at scale",
        kind: "scale",
        replacement: null,
        how: "dropped",
      },
    ])[0];
    expect(g.replacement).toBeNull();
    expect(g.how).toBe("dropped");
  });
});

describe("withoutFigure / claimTextOf", () => {
  it("removes the invented figure and its preposition", () => {
    expect(withoutFigure(FIGURE.bullet, FIGURE.claim)).toBe(
      "Boosted inventory turnover across marketplaces",
    );
    expect(withoutFigure("Boosted inventory turnover by 15\\%", "15\\%")).toBe(
      "Boosted inventory turnover",
    );
  });

  it("handles a figure written without the LaTeX percent escape", () => {
    expect(withoutFigure("Boosted turnover by 15%", "15%")).toBe(
      "Boosted turnover",
    );
  });

  it("removes every figure on a bullet with several", () => {
    const b = "Raised margin by 12\\% and turnover by 18\\% over 18 months";
    const [g] = groupSoftened([
      { claim: "12\\%", kind: "figure", bullet: b, how: "rewritten" },
      { claim: "18\\%", kind: "figure", bullet: b, how: "rewritten" },
      { claim: "18", kind: "figure", bullet: b, how: "rewritten" },
    ]);
    expect(claimTextOf(g)).toBe("Raised margin and turnover over months");
  });

  it("keeps a qualitative claim's bullet as written", () => {
    expect(claimTextOf(groupSoftened([LEAD])[0])).toBe(LEAD.bullet);
  });
});

describe("answerIsSet", () => {
  it("needs a value for a figures-only bullet", () => {
    const [g] = groupSoftened([FIGURE]);
    expect(answerIsSet(g, { keep: true, value: "" })).toBe(false);
    expect(answerIsSet(g, { keep: false, value: "12%" })).toBe(true);
  });

  it("accepts keep or a value for a bullet with a qualitative claim", () => {
    const [g] = groupSoftened([LEAD]);
    expect(answerIsSet(g, { keep: true, value: "" })).toBe(true);
    expect(answerIsSet(g, { keep: false, value: "5" })).toBe(true);
    expect(answerIsSet(g, { keep: false, value: "  " })).toBe(false);
    expect(answerIsSet(g, undefined)).toBe(false);
  });
});

describe("metricsFromAnswers", () => {
  it("saves nothing when nothing was answered — leaving it out is the default", () => {
    expect(metricsFromAnswers([FIGURE, LEAD], {}, NOW)).toEqual([]);
  });

  it("saves a real figure against the claim, never the invented one", () => {
    // Everything saved is rendered into the grounding pool, so the invented
    // 15% must appear nowhere in the metric.
    const out = metricsFromAnswers(
      [FIGURE],
      { [FIGURE.bullet]: { keep: false, value: "12%" } },
      NOW,
    );
    expect(out).toEqual([
      {
        claim: "Boosted inventory turnover across marketplaces",
        value: "12%",
        addedAt: "2026-09-15T12:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/15\\?%/);
  });

  it("anchors a confirmed claim to the bullet as shipped", () => {
    const [m] = metricsFromAnswers(
      [LEAD],
      { [LEAD.bullet]: { keep: true, value: "" } },
      NOW,
    );
    expect(m.claim).toBe(LEAD.bullet);
    expect("value" in m).toBe(false);
    expect(m.anchor).toBe("Designed the pricing dashboard");
  });

  it("omits the anchor when the model rewrote the draft itself", () => {
    const [m] = metricsFromAnswers(
      [{ ...LEAD, replacement: undefined, how: "rewritten" }],
      { [LEAD.bullet]: { keep: true, value: "" } },
      NOW,
    );
    expect("anchor" in m).toBe(false);
  });

  it("attaches a figure typed alongside a confirmed claim", () => {
    const [m] = metricsFromAnswers(
      [LEAD],
      { [LEAD.bullet]: { keep: true, value: "5 engineers" } },
      NOW,
    );
    expect(m.value).toBe("5 engineers");
  });

  it("saves one metric for a bullet with several claims", () => {
    const out = metricsFromAnswers(
      [LEAD, { ...LEAD, claim: "at scale", kind: "scale" }],
      { [LEAD.bullet]: { keep: true, value: "" } },
      NOW,
    );
    expect(out).toHaveLength(1);
  });
});

describe("mergeMetrics", () => {
  const existing = [{ claim: "Led the pricing work", addedAt: "x" }];

  it("appends new metrics after the existing ones", () => {
    const out = mergeMetrics(existing, [{ claim: "New", addedAt: "y" }]);
    expect(out.map((m) => m.claim)).toEqual(["Led the pricing work", "New"]);
  });

  it("skips an exact repeat, case-insensitively", () => {
    const out = mergeMetrics(existing, [
      { claim: "led the pricing work", addedAt: "y" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps the same claim with a different value", () => {
    const out = mergeMetrics(existing, [
      { claim: "Led the pricing work", value: "5", addedAt: "y" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("starts from nothing when the profile has no metrics", () => {
    expect(mergeMetrics(undefined, [])).toEqual([]);
  });
});
