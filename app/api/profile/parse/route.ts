import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL_FAST } from "@/lib/anthropic";
import { PROFILE_SCHEMA } from "@/lib/profile-schema";
import type { ParsedProfile } from "@/lib/profile";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM_PROMPT = `You extract structured information from LaTeX resumes and CVs.

Rules:
- Extract only what is present in the source. Do NOT invent, infer, or paraphrase content.
- Strip LaTeX commands and macros from the extracted text — return plain readable strings.
- For sections that are absent, return an empty array (not null).
- For optional string fields that are absent, return an empty string.
- For bullets, return one entry per actual bullet point in the source.
- For skills, group by category if the source groups them; also produce a flat deduplicated list.

Respond with a JSON object matching the provided schema. No prose outside the JSON.`;

export async function POST(req: NextRequest) {
  try {
    const { latex } = (await req.json()) as { latex?: string };
    if (!latex?.trim()) {
      return NextResponse.json(
        { error: "Missing 'latex' field." },
        { status: 400 },
      );
    }

    const client = getAnthropic();

    const response = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: {
          type: "json_schema",
          schema: PROFILE_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: `Extract the structured profile from this LaTeX source.

=== LATEX SOURCE ===
${latex}

Return JSON matching the schema.`,
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

    let parsed: ParsedProfile;
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

    return NextResponse.json({ parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/profile/parse]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
