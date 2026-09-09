import { NextRequest, NextResponse } from "next/server";
import { completeJson, llmErrorResponse } from "@/lib/llm";
import { PROFILE_SCHEMA } from "@/lib/profile-schema";
import type { ParsedProfile } from "@/lib/profile";
import { PROFILE_MERGE_SYSTEM_PROMPT } from "@/lib/prompts/profile-merge";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { resumeLatex, cvLatex, additionalSkills } = (await req.json()) as {
      resumeLatex?: string;
      cvLatex?: string;
      additionalSkills?: string;
    };

    const hasResume = !!resumeLatex?.trim();
    const hasCv = !!cvLatex?.trim();
    const hasNotes = !!additionalSkills?.trim();

    if (!hasResume && !hasCv && !hasNotes) {
      return NextResponse.json(
        {
          error:
            "Provide at least one of resumeLatex, cvLatex, or additionalSkills.",
        },
        { status: 400 },
      );
    }

    const sections: string[] = [];
    if (hasResume) {
      sections.push(`=== RESUME (LaTeX) — source tag: "resume" ===
${resumeLatex}`);
    } else {
      sections.push(`=== RESUME ===\n(not provided)`);
    }
    if (hasCv) {
      sections.push(`=== CV (LaTeX) — source tag: "cv" ===
${cvLatex}`);
    } else {
      sections.push(`=== CV ===\n(not provided)`);
    }
    if (hasNotes) {
      sections.push(`=== ADDITIONAL SKILLS & NOTES (free text) — source tag: "notes" ===
${additionalSkills}`);
    } else {
      sections.push(`=== ADDITIONAL SKILLS & NOTES ===\n(not provided)`);
    }

    const parsed = await completeJson<ParsedProfile>({
      tier: "fast",
      maxTokens: 12000,
      system: PROFILE_MERGE_SYSTEM_PROMPT,
      schema: PROFILE_SCHEMA,
      messages: [
        {
          role: "user",
          content: `Build the unified profile from the inputs below. Merge overlapping entries. Tag each item with its source(s).

${sections.join("\n\n")}

Return JSON matching the schema.`,
        },
      ],
    });

    return NextResponse.json({ parsed });
  } catch (err) {
    console.error("[/api/profile/build]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
