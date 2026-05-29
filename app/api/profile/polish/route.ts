import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL_FAST } from "@/lib/anthropic";

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

const SYSTEM_PROMPT = `You polish rough candidate-supplied input into clean, comprehensive CV entries.

CONTEXT: this is going into the candidate's CV (NOT a resume). The CV is the full source of truth — entries here can be more comprehensive than what would fit on a resume. Use detailed bullets that capture scope, responsibilities, and outcomes.

CORE RULES:
1. The user's rough input is the source of truth. NEVER add facts they didn't provide. Do not invent companies, dates, technologies, scope, or outcomes.
2. NEVER fabricate duration or quantity claims. Do not introduce phrases like "5+ years", "100+ hours", "10+ years working with X" unless those exact figures appear in the user's input.
3. Use a clean, professional voice consistent with how experienced candidates write CVs.
4. If the user's description is vague, write vaguer bullets — don't make it sound impressive at the cost of honesty.
5. Bullets start with action verbs. No first-person ("I"). Past tense for completed work, present tense for current.
6. Don't keyword-stuff. Don't pad. Each bullet must carry distinct information.
7. Clean up the user's input — fix obvious typos, normalize capitalization, expand abbreviations only when unambiguous — but never alter substantive content.

OUTPUT FORMAT: JSON matching the provided schema. Include a one-sentence 'summary' (e.g., "Polished a Senior Engineer role at Acme into 4 outcome-focused bullets") so the user can quickly see what you produced. No prose outside the JSON.`;

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

    const client = getAnthropic();
    const schema = schemaFor(kind);

    const response = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema },
      },
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

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "Model returned no text content." },
        { status: 502 },
      );
    }

    let parsed: { summary: string; polished: Record<string, unknown> };
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

    return NextResponse.json({
      kind,
      summary: parsed.summary,
      polished: parsed.polished,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/profile/polish]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
