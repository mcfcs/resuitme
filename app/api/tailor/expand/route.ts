import { NextRequest, NextResponse } from "next/server";
import { completeJson, llmErrorResponse } from "@/lib/llm";
import { EXPAND_SYSTEM_PROMPT } from "@/lib/prompts/expand";
import { filterGroundedAdditions } from "@/lib/ats/quote-check";
import {
  fitStrategyBlock,
  honestyBlock,
  type HonestSignals,
} from "@/lib/prompts/context";
import type { Analysis } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXPAND_SCHEMA = {
  type: "object",
  properties: {
    canExpand: {
      type: "boolean",
      description:
        "False when the profile pool holds no further material that is both real and relevant to this job. Answering false is a CORRECT and expected answer for a sparse profile — a short profile should produce a short résumé. Never invent material to avoid answering false.",
    },
    headroomAssessment: {
      type: "string",
      description:
        "One sentence: what real, unused material remains in the profile — or why none does.",
    },
    suggestedAdditions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description:
              "Executable instruction naming the target section and entry as they appear on the résumé, and exactly what to add. e.g. 'Under Experience → Acme Corp, restore the bullet about the data migration'. Never vague ('add more detail').",
          },
          sourceQuote: {
            type: "string",
            description:
              "VERBATIM excerpt (at least 15 characters) copied from the CANDIDATE PROFILE POOL that supplies this material. The system checks this against the pool and DISCARDS any addition whose quote is not really there. If you cannot quote it, the material does not exist — omit the addition.",
          },
          kind: {
            type: "string",
            enum: ["restore-detail", "add-item", "expand-skills"],
            description:
              "restore-detail = more real detail about an item already on the résumé; add-item = a whole profile item currently missing; expand-skills = further real skills the JD asks for.",
          },
          estimatedChars: {
            type: "integer",
            description:
              "Approximate visible characters this addition contributes. A résumé bullet is typically 100-200.",
          },
        },
        required: ["instruction", "sourceQuote", "kind", "estimatedChars"],
        additionalProperties: false,
      },
      description:
        "Ranked by JD relevance, highest first. Empty when canExpand is false.",
    },
  },
  required: ["canExpand", "headroomAssessment", "suggestedAdditions"],
  additionalProperties: false,
} as const;

type ExpandPlan = {
  canExpand: boolean;
  headroomAssessment: string;
  suggestedAdditions: Array<{
    instruction: string;
    sourceQuote: string;
    kind: string;
    estimatedChars: number;
  }>;
};

export type ExpandResponse = {
  /** Instructions the generator should apply. Already quote-verified. */
  suggestedAdditions: string[];
  /** How many proposals were discarded as ungrounded. */
  droppedUnquoted: number;
  headroomAssessment?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    const {
      latex,
      jobDescription,
      profilePool,
      shortBy,
      budget,
      analysis,
      honest,
    } = (await req.json()) as {
      latex?: string;
      jobDescription?: string;
      /** The candidate's full material — the only legal source of additions. */
      profilePool?: string;
      shortBy?: number;
      budget?: number;
      analysis?: Analysis;
      honest?: HonestSignals;
    };

    if (!latex?.trim() || !jobDescription?.trim()) {
      return NextResponse.json(
        { error: "latex and jobDescription are required." },
        { status: 400 },
      );
    }

    // Without a pool there is nothing to ground a quote against, so every
    // addition would be discarded. Decline rather than burn a model call.
    if (!profilePool?.trim()) {
      return NextResponse.json({
        suggestedAdditions: [],
        droppedUnquoted: 0,
        headroomAssessment: "No profile pool supplied; nothing to draw from.",
      } satisfies ExpandResponse);
    }

    const plan = await completeJson<ExpandPlan>({
      tier: "primary",
      maxTokens: 4000,
      system: EXPAND_SYSTEM_PROMPT,
      schema: EXPAND_SCHEMA,
      messages: [
        {
          role: "user",
          content: `This résumé is ${shortBy ?? "some"} visible characters short of a full page${
            budget ? ` (budget ${budget})` : ""
          }. Identify real material from the profile pool that should be added.

=== JOB DESCRIPTION ===
${jobDescription}
${honest ? honestyBlock(honest) : ""}${fitStrategyBlock(analysis?.fit)}
=== CANDIDATE PROFILE POOL (the ONLY legal source of additions) ===
${profilePool}

=== CURRENT RÉSUMÉ (LaTeX) ===
${latex}

Return JSON matching the schema. Every addition needs a verbatim sourceQuote from the profile pool above.`,
        },
      ],
    });

    if (!plan.canExpand) {
      return NextResponse.json({
        suggestedAdditions: [],
        droppedUnquoted: 0,
        headroomAssessment: plan.headroomAssessment,
      } satisfies ExpandResponse);
    }

    // The honesty gate. An addition whose quote is not really in the pool was
    // invented, and never reaches the generator.
    const { grounded, dropped } = filterGroundedAdditions(
      plan.suggestedAdditions,
      profilePool,
    );

    if (dropped.length) {
      console.warn(
        `[/api/tailor/expand] discarded ${dropped.length} ungrounded addition(s):`,
        dropped.map((d) => d.sourceQuote.slice(0, 60)),
      );
    }

    return NextResponse.json({
      suggestedAdditions: grounded.map((a) => a.instruction),
      droppedUnquoted: dropped.length,
      headroomAssessment: plan.headroomAssessment,
    } satisfies ExpandResponse);
  } catch (err) {
    console.error("[/api/tailor/expand]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
