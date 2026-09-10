import { describe, it, expect, vi } from "vitest";
import {
  runTrimLoop,
  runFitLoop,
  type TrimDeps,
  type ExpandDeps,
  type TrimPhase,
} from "@/lib/trim-loop";
import type { PageCheck } from "@/lib/render";

/** A successful compile reporting `pages`. */
const measured = (pages: number): PageCheck => ({
  measured: true,
  pages,
  compiled: true,
});

/** Render unavailable — the loop must fall back to the char heuristic. */
const unmeasured = (): PageCheck => ({
  measured: false,
  pages: null,
  compiled: false,
  error: "Render service unreachable",
});

/** LaTeX whose visibleChars() is exactly `n`. */
function latexOf(n: number): string {
  return `\\begin{document}\n${"x".repeat(n)}\n\\end{document}`;
}

function deps(over: Partial<TrimDeps> = {}): TrimDeps {
  return {
    generate: vi.fn(async () => latexOf(100)),
    checkPages: vi.fn(async () => measured(1)),
    requestCuts: vi.fn(async () => ["Drop the Foo project (~200 chars)"]),
    ...over,
  };
}

describe("runTrimLoop — authoritative page count", () => {
  it("stops after one pass when the compile reports one page", async () => {
    const d = deps();
    const r = await runTrimLoop(1000, d);

    expect(r.fits).toBe(true);
    expect(r.pages).toBe(1);
    expect(r.iterations).toBe(1);
    expect(r.cutsApplied).toEqual([]);
    expect(d.generate).toHaveBeenCalledTimes(1);
    expect(d.requestCuts).not.toHaveBeenCalled();
  });

  it("treats a real one-page compile as fitting even when chars exceed budget", async () => {
    // The char heuristic says 5000 > 1000, but the compile is ground truth.
    const d = deps({ generate: vi.fn(async () => latexOf(5000)) });
    const r = await runTrimLoop(1000, d);

    expect(r.fits).toBe(true);
    expect(r.chars).toBe(5000);
    expect(d.requestCuts).not.toHaveBeenCalled();
  });

  it("trims when the compile reports two pages, even if chars are under budget", async () => {
    // Inverse of the case above: heuristic is happy, compile is not.
    const checkPages = vi
      .fn<TrimDeps["checkPages"]>()
      .mockResolvedValueOnce(measured(2))
      .mockResolvedValue(measured(1));
    const d = deps({ generate: vi.fn(async () => latexOf(100)), checkPages });

    const r = await runTrimLoop(1000, d);

    expect(r.fits).toBe(true);
    expect(r.iterations).toBe(2);
    expect(d.requestCuts).toHaveBeenCalledTimes(1);
  });

  it("feeds the accumulated cuts back into the next generate call", async () => {
    const checkPages = vi
      .fn<TrimDeps["checkPages"]>()
      .mockResolvedValueOnce(measured(2))
      .mockResolvedValue(measured(1));
    const generate = vi.fn(async () => latexOf(4000));
    const d = deps({
      generate,
      checkPages,
      requestCuts: vi.fn(async () => ["Drop Bar (~300 chars)"]),
    });

    const r = await runTrimLoop(1000, d);

    expect(generate).toHaveBeenNthCalledWith(1, undefined);
    expect(generate).toHaveBeenNthCalledWith(2, ["Drop Bar (~300 chars)"]);
    expect(r.cutsApplied).toEqual(["Drop Bar (~300 chars)"]);
  });

  it("accumulates cuts across several trim passes", async () => {
    const checkPages = vi.fn<TrimDeps["checkPages"]>(async () => measured(2));
    let n = 0;
    const d = deps({
      checkPages,
      generate: vi.fn(async () => latexOf(4000)),
      requestCuts: vi.fn(async () => [`cut-${++n}`]),
      maxPasses: 3,
    });

    const r = await runTrimLoop(1000, d);

    expect(r.iterations).toBe(3);
    expect(r.cutsApplied).toEqual(["cut-1", "cut-2"]);
    expect(r.fits).toBe(false);
  });
});

describe("runTrimLoop — fallback when rendering is unavailable", () => {
  it("accepts a draft under budget", async () => {
    const d = deps({
      checkPages: vi.fn(async () => unmeasured()),
      generate: vi.fn(async () => latexOf(900)),
    });
    const r = await runTrimLoop(1000, d);

    expect(r.fits).toBe(true);
    expect(r.pages).toBeNull();
    expect(r.iterations).toBe(1);
  });

  it("accepts an overshoot inside the 0.5% tolerance", async () => {
    const d = deps({
      checkPages: vi.fn(async () => unmeasured()),
      generate: vi.fn(async () => latexOf(1005)),
    });
    expect((await runTrimLoop(1000, d)).fits).toBe(true);
  });

  it("trims an overshoot beyond the tolerance", async () => {
    const generate = vi
      .fn<TrimDeps["generate"]>()
      .mockResolvedValueOnce(latexOf(2000))
      .mockResolvedValue(latexOf(900));
    const d = deps({ checkPages: vi.fn(async () => unmeasured()), generate });

    const r = await runTrimLoop(1000, d);

    expect(r.fits).toBe(true);
    expect(r.iterations).toBe(2);
    expect(d.requestCuts).toHaveBeenCalledTimes(1);
  });

  it("does not loop forever when the draft never shrinks", async () => {
    const d = deps({
      checkPages: vi.fn(async () => unmeasured()),
      generate: vi.fn(async () => latexOf(9000)),
      maxPasses: 4,
    });

    const r = await runTrimLoop(1000, d);

    expect(r.iterations).toBe(4);
    expect(r.fits).toBe(false);
    expect(d.generate).toHaveBeenCalledTimes(4);
  });
});

describe("runTrimLoop — verifier behaviour", () => {
  it("stops when the verifier returns no cuts, rather than spinning", async () => {
    const d = deps({
      checkPages: vi.fn(async () => measured(2)),
      generate: vi.fn(async () => latexOf(4000)),
      requestCuts: vi.fn(async () => []),
    });

    const r = await runTrimLoop(1000, d);

    expect(r.iterations).toBe(1);
    expect(r.fits).toBe(false);
    expect(d.generate).toHaveBeenCalledTimes(1);
  });

  it("sizes the cut target from the real page count when chars underestimate", async () => {
    // 100 chars against a 1000 budget is a NEGATIVE overshoot, yet the compile
    // says 2 pages. cutTarget must floor it at ~12% of budget per extra page.
    const requestCuts = vi.fn<TrimDeps["requestCuts"]>(async () => ["c"]);
    const d = deps({
      checkPages: vi.fn(async () => measured(2)),
      generate: vi.fn(async () => latexOf(100)),
      requestCuts,
      maxPasses: 2,
    });

    await runTrimLoop(1000, d);

    const [, chars, overBy] = requestCuts.mock.calls[0];
    expect(chars).toBe(100);
    expect(overBy).toBe(120); // round(1000 * 0.12) * (2 - 1)
    expect(overBy).toBeGreaterThan(0);
  });

  it("passes the latest draft, not the original, to the verifier", async () => {
    const requestCuts = vi.fn<TrimDeps["requestCuts"]>(async () => ["c"]);
    const generate = vi
      .fn<TrimDeps["generate"]>()
      .mockResolvedValueOnce(latexOf(4000))
      .mockResolvedValueOnce(latexOf(3000))
      .mockResolvedValue(latexOf(100));
    const d = deps({
      checkPages: vi.fn(async () => measured(2)),
      generate,
      requestCuts,
      maxPasses: 3,
    });

    await runTrimLoop(1000, d);

    expect(requestCuts.mock.calls[0][1]).toBe(4000);
    expect(requestCuts.mock.calls[1][1]).toBe(3000);
  });
});

describe("runTrimLoop — phase reporting", () => {
  it("reports build then render on a first-pass success", async () => {
    const phases: TrimPhase[] = [];
    await runTrimLoop(1000, deps({ onPhase: (p) => phases.push(p) }));
    expect(phases).toEqual(["build", "render"]);
  });

  it("reports verify and trim across a trim pass", async () => {
    const phases: TrimPhase[] = [];
    const checkPages = vi
      .fn<TrimDeps["checkPages"]>()
      .mockResolvedValueOnce(measured(2))
      .mockResolvedValue(measured(1));
    await runTrimLoop(
      1000,
      deps({ checkPages, onPhase: (p) => phases.push(p) }),
    );
    expect(phases).toEqual(["build", "render", "verify", "trim", "render"]);
  });

  it("works without an onPhase callback", async () => {
    await expect(runTrimLoop(1000, deps())).resolves.toBeDefined();
  });
});

describe("runTrimLoop — result shape", () => {
  it("reports the chars of the FINAL draft, not an intermediate one", async () => {
    const generate = vi
      .fn<TrimDeps["generate"]>()
      .mockResolvedValueOnce(latexOf(4000))
      .mockResolvedValue(latexOf(750));
    const checkPages = vi
      .fn<TrimDeps["checkPages"]>()
      .mockResolvedValueOnce(measured(2))
      .mockResolvedValue(measured(1));

    const r = await runTrimLoop(1000, deps({ generate, checkPages }));

    expect(r.chars).toBe(750);
    expect(r.latex).toContain("x".repeat(750));
  });

  it("surfaces the last known page count on failure", async () => {
    const d = deps({
      checkPages: vi.fn(async () => measured(3)),
      generate: vi.fn(async () => latexOf(9000)),
      maxPasses: 2,
    });
    const r = await runTrimLoop(1000, d);

    expect(r.fits).toBe(false);
    expect(r.pages).toBe(3);
  });
});

describe("runFitLoop — the expand pass", () => {
  /** Deps for a draft that lands under the floor and can be expanded. */
  function fitDeps(over: Partial<TrimDeps & ExpandDeps> = {}) {
    return {
      // 1000 chars against a 3420 budget = 29%, well under the 85% floor.
      generate: vi.fn(async (_cuts?: string[], additions?: string[]) =>
        additions?.length ? latexOf(3000) : latexOf(1000),
      ),
      checkPages: vi.fn(async () => measured(1)),
      requestCuts: vi.fn(async () => []),
      requestAdditions: vi.fn(async () => ["restore the Acme bullet"]),
      ...over,
    } as TrimDeps & ExpandDeps;
  }

  it("expands a draft that landed under the floor", async () => {
    const d = fitDeps();
    const r = await runFitLoop(3420, d);

    expect(r.expandPasses).toBe(1);
    expect(r.expandReverted).toBe(false);
    expect(r.chars).toBe(3000);
    expect(d.requestAdditions).toHaveBeenCalledTimes(1);
  });

  it("passes the additions to generate, not the cuts slot", async () => {
    const generate = vi.fn(async (_c?: string[], additions?: string[]) =>
      additions?.length ? latexOf(3000) : latexOf(1000),
    );
    await runFitLoop(3420, fitDeps({ generate }));

    expect(generate).toHaveBeenLastCalledWith(undefined, [
      "restore the Acme bullet",
    ]);
  });

  it("never calls the planner when the draft is already in band", async () => {
    // 3200 of 3420 is 94% — nothing to do.
    const d = fitDeps({ generate: vi.fn(async () => latexOf(3200)) });
    const r = await runFitLoop(3420, d);

    expect(d.requestAdditions).not.toHaveBeenCalled();
    expect(r.expandPasses).toBe(0);
    expect(r.chars).toBe(3200);
  });

  it("accepts the planner declining — a sparse profile keeps its short résumé", async () => {
    // The honesty outcome: nothing real left to add, so nothing is added.
    const d = fitDeps({ requestAdditions: vi.fn(async () => []) });
    const r = await runFitLoop(3420, d);

    expect(r.expandPasses).toBe(0);
    expect(r.expandReverted).toBe(false);
    expect(r.chars).toBe(1000);
    expect(d.generate).toHaveBeenCalledTimes(1);
  });

  it("reverts when the expanded draft spills onto a second page", async () => {
    const checkPages = vi
      .fn<TrimDeps["checkPages"]>()
      .mockResolvedValueOnce(measured(1)) // the trim loop's check
      .mockResolvedValue(measured(2)); // the expanded candidate
    const d = fitDeps({ checkPages });
    const r = await runFitLoop(3420, d);

    expect(r.expandReverted).toBe(true);
    expect(r.chars).toBe(1000); // the accepted draft, untouched
    expect(r.pages).toBe(1);
  });

  it("reverts when the expanded draft is not actually longer", async () => {
    // Guards a planner that makes things worse rather than better.
    const d = fitDeps({
      generate: vi.fn(async (_c?: string[], additions?: string[]) =>
        additions?.length ? latexOf(900) : latexOf(1000),
      ),
    });
    const r = await runFitLoop(3420, d);

    expect(r.expandReverted).toBe(true);
    expect(r.chars).toBe(1000);
  });

  it("reverts when the expanded draft blows the ceiling", async () => {
    const d = fitDeps({
      generate: vi.fn(async (_c?: string[], additions?: string[]) =>
        additions?.length ? latexOf(5000) : latexOf(1000),
      ),
      // Compile unavailable, so the char heuristic decides.
      checkPages: vi.fn(async () => unmeasured()),
    });
    const r = await runFitLoop(3420, d);

    expect(r.expandReverted).toBe(true);
    expect(r.chars).toBe(1000);
  });

  it("never expands a draft the trim loop could not fix", async () => {
    // Overflow is the hard failure; do not add content to a broken draft.
    const d = fitDeps({
      generate: vi.fn(async () => latexOf(9000)),
      checkPages: vi.fn(async () => measured(3)),
      requestCuts: vi.fn(async () => ["cut something"]),
      maxPasses: 2,
    } as Partial<TrimDeps & ExpandDeps>);
    const r = await runFitLoop(3420, d);

    expect(r.fits).toBe(false);
    expect(d.requestAdditions).not.toHaveBeenCalled();
    expect(r.expandPasses).toBe(0);
  });

  it("reports the expand phase for the busy indicator", async () => {
    const phases: TrimPhase[] = [];
    await runFitLoop(3420, fitDeps({ onPhase: (p) => phases.push(p) }));
    expect(phases).toContain("expand");
    // It runs after the trim loop settles, never interleaved with it.
    expect(phases.indexOf("expand")).toBeGreaterThan(phases.indexOf("build"));
  });

  it("honours a custom floor", async () => {
    // At a 25% floor, a 1000-char draft on a 3420 budget is already fine.
    const d = fitDeps();
    const r = await runFitLoop(3420, d, { floorFraction: 0.25 });

    expect(d.requestAdditions).not.toHaveBeenCalled();
    expect(r.expandPasses).toBe(0);
  });
});
