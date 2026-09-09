import { NextRequest, NextResponse } from "next/server";
import { completeJson, llmErrorResponse } from "@/lib/llm";
import { PROFILE_POLISH_SYSTEM_PROMPT } from "@/lib/prompts/profile-polish";

export const runtime = "nodejs";
export const maxDuration = 60;

export type PolishKind =
  | "experience"
  | "project"
  | "education"
  | "award"
  | "publication";

const POLISHED_SHAPES = {
  experience: {
    type: "object",
    properties: {
      company: { type: "string" },
      role: { type: "string" },
      dates: { type: "string" },
      location: { type: "string" },
      bullets: {
        type: "array",
        items: { type: "string" },
        description:
          "3-6 CV-quality bullets describing what was done, scope, and outcomes. Action-verb leading.",
      },
    },
    required: ["company", "role", "dates", "location", "bullets"],
    additionalProperties: false,
  },
  project: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: {
        type: "string",
        description: "One-sentence description of the project.",
      },
      tech: {
        type: "array",
        items: { type: "string" },
        description: "Technologies/tools used.",
      },
      bullets: {
        type: "array",
        items: { type: "string" },
        description: "2-4 CV-quality bullets about what was built and impact.",
      },
    },
    required: ["name", "description", "tech", "bullets"],
    additionalProperties: false,
  },
  education: {
    type: "object",
    properties: {
      institution: { type: "string" },
      degree: { type: "string" },
      field: { type: "string" },
      dates: { type: "string" },
      location: { type: "string" },
      details: {
        type: "array",
        items: { type: "string" },
        description:
          "1-4 detail lines (GPA, honors, coursework, thesis, etc.). Empty array if user provided no details.",
      },
    },
    required: ["institution", "degree", "field", "dates", "location", "details"],
    additionalProperties: false,
  },
  award: {
    type: "object",
    properties: {
      name: { type: "string" },
      year: { type: "string" },
      description: { type: "string" },
    },
    required: ["name", "year", "description"],
    additionalProperties: false,
  },
  publication: {
    type: "object",
    properties: {
      title: { type: "string" },
      venue: { type: "string" },
      year: { type: "string" },
    },
    required: ["title", "venue", "year"],
    additionalProperties: false,
  },
} as const;

function schemaFor(kind: PolishKind) {
  return {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "One-sentence summary of what was polished. Shown to the user for review.",
      },
      polished: POLISHED_SHAPES[kind],
    },
    required: ["summary", "polished"],
    additionalProperties: false,
  } as const;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      kind?: PolishKind;
      rough?: Record<string, unknown>;
    };
    const { kind, rough } = body;

    if (!kind || !(kind in POLISHED_SHAPES)) {
      return NextResponse.json(
        { error: "Invalid or missing 'kind'." },
        { status: 400 },
      );
    }
    if (!rough || typeof rough !== "object") {
      return NextResponse.json(
        { error: "Missing 'rough' input." },
        { status: 400 },
      );
    }

    const parsed = await completeJson<{
      summary: string;
      polished: Record<string, unknown>;
    }>({
      tier: "fast",
      maxTokens: 4000,
      system: PROFILE_POLISH_SYSTEM_PROMPT,
      schema: schemaFor(kind),
      messages: [
        {
          role: "user",
          content: `Section: ${kind}

User's rough input (JSON — treat as authoritative; do not embellish beyond it):
${JSON.stringify(rough, null, 2)}

Polish into a clean CV entry. Return JSON matching the schema.`,
        },
      ],
    });

    return NextResponse.json({
      kind,
      summary: parsed.summary,
      polished: parsed.polished,
    });
  } catch (err) {
    console.error("[/api/profile/polish]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
