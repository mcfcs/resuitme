import { describe, it, expect, vi } from "vitest";
import { runTrimLoop, type TrimDeps, type TrimPhase } from "@/lib/trim-loop";
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
