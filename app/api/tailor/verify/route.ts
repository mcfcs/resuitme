import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL_FAST } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 120;

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    fits: {
      type: "boolean",
      description:
        "Whether the resume already fits the one-page budget. If true, suggestedCuts may be empty.",
    },
    estimatedReduction: {
      type: "integer",
      description:
        "Total estimated visible-character reduction if all suggested cuts are applied.",
    },
    suggestedCuts: {
      type: "array",
      items: { type: "string" },
      description:
        "3-8 specific, concrete cut recommendations. Each item must reference an actual entry by name or section, name what to drop or trim, and estimate the saved characters in parentheses. Example: 'Drop the entire \"Acme Corp\" experience (~420 chars)' or 'Trim each bullet under \"Foo Inc\" to one line (~180 chars)'.",
    },
    rationale: {
      type: "string",
      description:
        "One short sentence explaining your overall cut strategy.",
    },
  },
  required: ["fits", "estimatedReduction", "suggestedCuts", "rationale"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a length editor for résumés. You receive a résumé LaTeX source that is OVER the one-page visible-character budget. Your job is to recommend the cuts that will bring it under budget — AGGRESSIVELY, not gently.

CRITICAL: your suggested cuts must, in total, save AT LEAST 1.5x the overshoot. If the overshoot is 200 chars, your cuts must collectively save ≥300 chars. Under-cutting causes another costly round-trip; over-cutting is preferred to under-cutting.

WHAT TO CUT — in priority order, drop or trim:
1. ENTIRE items first, line edits second. Dropping a whole project / role / section saves more than trimming bullets.
2. Sections that are weakly relevant to the JD (e.g. a Publications block on a non-research role) — drop the section header AND its contents.
3. Older or junior experience entries that the JD doesn't require.
4. Lower-priority projects when the candidate already has stronger JD-aligned projects.
5. Individual bullets that don't surface JD-relevant skills or quantified impact.
6. Padding language inside bullets (adjectives, filler clauses).
7. Multi-line objective/summary paragraphs — collapse to one sentence or remove.

WHAT NOT TO CUT:
- Contact info, name, education with relevant credentials.
- The single most recent JD-aligned role's strongest 2-3 bullets.
- Skills explicitly listed in the JD (when the candidate has them).

EACH SUGGESTED CUT MUST:
- Reference a real entry by NAME (e.g., "Drop the 'Bar Project' entry entirely"). Vague suggestions ("shorten things", "tighten bullets") are forbidden.
- Estimate the chars saved in parentheses, conservatively (under-promise, over-deliver).
- Be executable verbatim by a downstream model. No interpretation required.

CHECK YOUR WORK: sum your "(~N chars)" estimates. If the sum is less than 1.5x the overshoot, add more cuts. It is BETTER to recommend dropping an entire weakly-relevant section than to trim five bullets that don't add up.

Respond with JSON matching the provided schema. No prose outside the JSON.`;

export async function POST(req: NextRequest) {
  try {
    const { latex, jobDescription, budget, currentChars, overBy } =
      (await req.json()) as {
        latex?: string;
        jobDescription?: string;
        budget?: number;
        currentChars?: number;
        overBy?: number;
      };

    if (!latex?.trim()) {
      return NextResponse.json({ error: "Missing latex." }, { status: 400 });
    }
    if (typeof budget !== "number") {
      return NextResponse.json({ error: "Missing budget." }, { status: 400 });
    }

    const client = getAnthropic();

    const response = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: VERIFY_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Current visible-character count: ${currentChars ?? "unknown"}
One-page budget: ${budget}
Over by: ${overBy ?? "unknown"} chars (need to reduce by at least this much)

=== JOB DESCRIPTION (for relevance-prioritization when deciding what to cut) ===
${jobDescription ?? "(not provided)"}

=== CURRENT TAILORED RESUME LATEX ===
${latex}

Recommend specific cuts to bring this under the one-page budget. Return JSON matching the schema.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "Model returned no text content." },
        { status: 502 },
      );
    }

    let parsed: {
      fits: boolean;
      estimatedReduction: number;
      suggestedCuts: string[];
      rationale: string;
    };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return NextResponse.json(
        {
          error: "Model returned invalid JSON.",
          raw: textBlock.text.slice(0, 2000),
        },
        { status: 502 },
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/tailor/verify]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
