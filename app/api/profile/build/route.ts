import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL_FAST } from "@/lib/anthropic";
import { PROFILE_SCHEMA } from "@/lib/profile-schema";
import type { ParsedProfile } from "@/lib/profile";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM_PROMPT = `You build ONE unified candidate profile from up to three inputs: a base resume (LaTeX), a base CV (LaTeX), and a free-form additional-skills notes block.

The resume and CV describe the SAME PERSON. They overlap. The resume is usually a condensed/curated subset of the CV. Both may also contain information the other lacks. Your job is to MERGE them into a single profile — never produce two parallel lists.

MERGING RULES:
- For experience: same job = same company AND overlapping dates (allow for minor formatting differences in company name and dates). When merged, take the UNION of bullets across sources — keep distinct accomplishments even if worded differently; drop only true duplicates. Use the more complete version of role title, dates, and location.
- For projects: same project = same name (allow case/punctuation variation). Same merge rule for bullets and tech.
- For education: same education = same institution AND same degree. Union the details (GPA, coursework, thesis, honors).
- For skills: union across all three inputs (resume + CV + notes), deduplicated. If the resume/CV organizes skills into categories, preserve those categories and add new items from the CV/notes into matching categories where appropriate.
- For awards and publications: dedupe by name/title; union details.
- For contact info: prefer the most complete value; union the links.
- The additional-skills notes block is informal free text. Parse it for skills, certifications-in-progress, exposure-level statements, and add them into the unified skills list with source "notes". If it mentions specific tools (e.g. "comfortable with Rust"), include those.

SOURCE TAGGING:
- Each item (experience/project/education/award/publication) gets a "sources" array indicating which input(s) it came from: "resume", "cv", and/or "notes".
- An item that appears in BOTH resume and CV gets sources: ["resume", "cv"].
- An item that only appears in the CV gets sources: ["cv"].
- Skill items inside categories are flat — no source tags on individual skills.

INTEGRITY RULES:
- Never invent, infer, or paraphrase content the candidate did not write somewhere in the inputs.
- Strip LaTeX commands and macros — return plain readable strings.
- For sections that are absent, return an empty array.
- For optional string fields that are absent, return an empty string.

Respond with a JSON object matching the provided schema. No prose outside the JSON.`;

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

    const client = getAnthropic();

    const response = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 12000,
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
          content: `Build the unified profile from the inputs below. Merge overlapping entries. Tag each item with its source(s).

${sections.join("\n\n")}

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
    console.error("[/api/profile/build]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
