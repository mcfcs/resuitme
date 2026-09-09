import { NextRequest, NextResponse } from "next/server";
import { completeJson, llmErrorResponse } from "@/lib/llm";
import { VERIFY_SYSTEM_PROMPT } from "@/lib/prompts/verify";

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
      description: "One short sentence explaining your overall cut strategy.",
    },
  },
  required: ["fits", "estimatedReduction", "suggestedCuts", "rationale"],
  additionalProperties: false,
} as const;

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

    const parsed = await completeJson<{
      fits: boolean;
      estimatedReduction: number;
      suggestedCuts: string[];
      rationale: string;
    }>({
      tier: "primary",
      maxTokens: 4000,
      system: VERIFY_SYSTEM_PROMPT,
      schema: VERIFY_SCHEMA,
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

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[/api/tailor/verify]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
