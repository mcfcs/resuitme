import { describe, it, expect, vi, beforeEach } from "vitest";

// The route is exercised end to end with the model mocked out: every gate,
// the retry decision and the code backstop are deterministic, and this is
// where their interaction is pinned. No model, no network.
vi.mock("@/lib/llm", () => ({
  completeText: vi.fn(),
  llmErrorResponse: (err: unknown) => ({
    error: err instanceof Error ? err.message : String(err),
    status: 500,
  }),
}));

import { completeText } from "@/lib/llm";
import { POST, type BuildResponse } from "@/app/api/build/route";

const model = vi.mocked(completeText);

/** The e-commerce profile behind the measured fabrications. */
const PROFILE = [
  "Independent E-commerce Operator (Retail), Self-Employed.",
  "Operated a sneaker resale business across marketplaces including StockX.",
  "Developed demand-based dynamic pricing strategies to maximize margins",
  "and inventory turnover. Contact +63 999-106-2601.",
].join(" ");

function doc(...bullets: string[]): string {
  return [
    "\\documentclass{article}",
    "\\begin{document}",
    "\\resumeItemListStart",
    ...bullets.map((b) => `  \\resumeItem{${b}}`),
    "\\resumeItemListEnd",
    "\\end{document}",
  ].join("\n");
}

const CLEAN = doc(
  "Operated a sneaker resale business across marketplaces",
  "Developed dynamic pricing strategies to maximize margins",
);
const DIRTY = doc(
  "Led a team to develop dynamic pricing strategies",
  "Operated a sneaker resale business across marketplaces",
);

async function build(
  over: Record<string, unknown> = {},
): Promise<{ status: number; body: BuildResponse & { error?: string } }> {
  const req = new Request("http://localhost/api/build", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobDescription: "Pricing analyst for an e-commerce marketplace.",
      profileContext: { baseCvLatex: PROFILE },
      budget: 3420,
      ...over,
    }),
  });
  const res = await POST(req as never);
  return { status: res.status, body: await res.json() };
}

/** The user message of the nth model call. */
function userMessage(n: number): string {
  return model.mock.calls[n][0].messages[0].content;
}

beforeEach(() => {
  model.mockReset();
});

describe("/api/build — honesty gate", () => {
  it("returns a clean first draft unchanged, with no retry", async () => {
    model.mockResolvedValueOnce(CLEAN);
    const { status, body } = await build();
    expect(status).toBe(200);
    expect(body).toEqual({ latex: CLEAN });
    expect(model).toHaveBeenCalledTimes(1);
    expect(userMessage(0)).not.toContain("UNSUPPORTED CLAIMS");
  });

  it("retries once, naming the claim, and reports the model's rewrite", async () => {
    model.mockResolvedValueOnce(DIRTY).mockResolvedValueOnce(CLEAN);
    const { body } = await build();
    expect(model).toHaveBeenCalledTimes(2);
    expect(userMessage(1)).toContain("UNSUPPORTED CLAIMS");
    expect(userMessage(1)).toContain('"Led" (leadership)');
    expect(body.latex).toBe(CLEAN);
    expect(body.honestyRetry).toBe(true);
    expect(body.softened).toEqual([
      {
        claim: "Led",
        kind: "leadership",
        bullet: "Led a team to develop dynamic pricing strategies",
        how: "rewritten",
      },
    ]);
  });

  it("strips in code what the retry still carries", async () => {
    // The prompt asked; the model did not comply. The guarantee is code.
    model.mockResolvedValueOnce(DIRTY).mockResolvedValueOnce(DIRTY);
    const { body } = await build();
    expect(body.latex).toContain(
      "\\resumeItem{Developed dynamic pricing strategies}",
    );
    expect(body.latex).not.toMatch(/\bLed\b/);
    expect(body.softened).toEqual([
      {
        claim: "Led",
        kind: "leadership",
        bullet: "Led a team to develop dynamic pricing strategies",
        replacement: "Developed dynamic pricing strategies",
        how: "stripped",
      },
    ]);
  });

  it("discards a retry that invents more, then strips the first draft", async () => {
    const worse = doc(
      "Led a team to develop dynamic pricing strategies",
      "Boosted inventory turnover by 15\\%",
    );
    model.mockResolvedValueOnce(DIRTY).mockResolvedValueOnce(worse);
    const { body } = await build();
    expect(body.latex).not.toContain("15");
    expect(body.latex).toContain("{Developed dynamic pricing strategies}");
    expect(body.latex).toContain("{Operated a sneaker resale business");
  });

  it("keeps and strips the first draft when the retry fails", async () => {
    model.mockResolvedValueOnce(DIRTY).mockRejectedValueOnce(new Error("down"));
    const { status, body } = await build();
    expect(status).toBe(200);
    expect(body.latex).toContain("{Developed dynamic pricing strategies}");
    expect(body.honestyRetry).toBe(true);
    expect(body.softened?.[0].how).toBe("stripped");
  });

  it("removes an invented figure the retry kept, and counts what it cannot", async () => {
    const figures = doc(
      "Boosted inventory turnover by 15\\%",
      "Tracked orders across 10+ lifecycle states",
    );
    model.mockResolvedValueOnce(figures).mockResolvedValueOnce(figures);
    const { body } = await build();
    expect(userMessage(1)).toContain("FABRICATED FIGURES");
    expect(body.latex).toContain("{Boosted inventory turnover}");
    expect(body.latex).toContain("10+ lifecycle states");
    expect(body.ungroundedNumbers).toBe(1);
    expect(body.softened).toEqual([
      {
        claim: "15\\%",
        kind: "figure",
        bullet: expect.stringContaining("inventory turnover by 15"),
        how: "stripped",
      },
    ]);
  });

  it("never ships an invented phone number", async () => {
    const header = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\small +1 555-123-4567 $|$ a@b.c",
      "\\resumeItem{Operated a sneaker resale business across marketplaces}",
      "\\end{document}",
    ].join("\n");
    model.mockResolvedValueOnce(header).mockResolvedValueOnce(header);
    const { body } = await build();
    expect(body.latex).not.toContain("555");
    expect(body.latex).toContain("\\small a@b.c");
    expect(body.ungroundedNumbers).toBe(0);
  });

  it("treats a candidate-confirmed metric as grounded", async () => {
    // The metrics panel wrote this to the profile; the gate must not flag
    // the very figure the candidate just asserted.
    model.mockResolvedValueOnce(doc("Boosted inventory turnover by 15\\%"));
    const { body } = await build({
      profileContext: {
        baseCvLatex: PROFILE,
        metrics: [
          {
            claim: "Boosted inventory turnover",
            value: "15%",
            addedAt: "2026-09-15T00:00:00.000Z",
          },
        ],
      },
    });
    expect(model).toHaveBeenCalledTimes(1);
    expect(body.latex).toContain("15\\%");
    expect(body.softened).toBeUndefined();
    expect(userMessage(0)).toContain("Candidate-confirmed figures and claims");
    expect(userMessage(0)).toContain("Boosted inventory turnover: 15%");
  });

  it("treats a candidate-confirmed qualitative claim as grounded", async () => {
    model.mockResolvedValueOnce(DIRTY);
    const { body } = await build({
      profileContext: {
        baseCvLatex: PROFILE,
        metrics: [
          {
            claim: "Led the pricing work",
            addedAt: "2026-09-15T00:00:00.000Z",
          },
        ],
      },
    });
    expect(model).toHaveBeenCalledTimes(1);
    expect(body.latex).toBe(DIRTY);
  });

  it("does not let the analyzer's own prose ground a qualitative claim", async () => {
    // The analysis is model-written. "led" in a suggestion must not ground
    // "Led" in the output — that is the loop the gate exists to break.
    model.mockResolvedValueOnce(DIRTY).mockResolvedValueOnce(CLEAN);
    await build({
      analysis: {
        score: 70,
        verdict: "ok",
        strengths: [],
        gaps: [],
        suggestions: ["Say you led the pricing work"],
        must_include: [],
        fit: {
          domain_match: "direct",
          seniority_match: "at",
          transferable: [],
          disqualifying: [],
        },
        keyword_coverage: { present: [], missing: [], partial: [] },
      },
    });
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("rejects a request with no job description", async () => {
    const { status, body } = await build({ jobDescription: "" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/jobDescription/);
    expect(model).not.toHaveBeenCalled();
  });
});
