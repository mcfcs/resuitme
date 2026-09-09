import { describe, it, expect } from "vitest";
import { cutTarget } from "@/lib/render";

describe("cutTarget", () => {
  const BUDGET = 3000;
  // Per-extra-page floor is round(budget * 0.12) per page over one.
  const PER_PAGE = Math.round(BUDGET * 0.12); // 360

  describe("when the render confirmed more than one page", () => {
    it("floors the cut at ~12% of budget when the heuristic underestimated", () => {
      // The char heuristic thought it fit (overshoot <= 0) but the compile
      // says 2 pages — we still need a positive cut or the loop stalls.
      expect(cutTarget(2, 0, BUDGET)).toBe(PER_PAGE);
      expect(cutTarget(2, -500, BUDGET)).toBe(PER_PAGE);
    });

    it("scales the floor with each extra page", () => {
      expect(cutTarget(3, 0, BUDGET)).toBe(PER_PAGE * 2);
      expect(cutTarget(4, 0, BUDGET)).toBe(PER_PAGE * 3);
    });

    it("prefers the heuristic overshoot when it is larger than the floor", () => {
      expect(cutTarget(2, 1200, BUDGET)).toBe(1200);
    });

    it("prefers the floor when the heuristic overshoot is smaller", () => {
      expect(cutTarget(2, 100, BUDGET)).toBe(PER_PAGE);
    });

    it("returns a strictly positive target for any over-length page count", () => {
      for (const pages of [2, 3, 5]) {
        expect(cutTarget(pages, -9999, BUDGET)).toBeGreaterThan(0);
      }
    });
  });

  describe("when the page count is exactly one", () => {
    it("falls back to the heuristic overshoot", () => {
      expect(cutTarget(1, 250, BUDGET)).toBe(250);
    });

    it("never returns a negative target", () => {
      expect(cutTarget(1, -400, BUDGET)).toBe(0);
    });
  });

  describe("when the page count is unavailable", () => {
    it("uses the heuristic overshoot for null pages", () => {
      expect(cutTarget(null, 700, BUDGET)).toBe(700);
    });

    it("clamps a negative overshoot to zero for null pages", () => {
      expect(cutTarget(null, -50, BUDGET)).toBe(0);
    });

    it("returns zero when nothing needs cutting", () => {
      expect(cutTarget(null, 0, BUDGET)).toBe(0);
    });
  });

  it("scales the floor with the budget", () => {
    expect(cutTarget(2, 0, 5000)).toBe(Math.round(5000 * 0.12));
    expect(cutTarget(2, 0, 1000)).toBe(Math.round(1000 * 0.12));
  });

  it("returns an integer for any input", () => {
    expect(Number.isInteger(cutTarget(2, 0, 3333))).toBe(true);
    expect(Number.isInteger(cutTarget(3, 17, 2777))).toBe(true);
  });
});
