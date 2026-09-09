import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";
import { INSERT_CV_SYSTEM_PROMPT } from "@/lib/prompts/insert-cv";

export const runtime = "nodejs";
export const maxDuration = 180;

export type InsertSection =
  "experience" | "project" | "education" | "award" | "publication";

export async function POST(req: NextRequest) {
  try {
    const { cvLatex, section, polished } = (await req.json()) as {
      cvLatex?: string;
      section?: InsertSection;
      polished?: Record<string, unknown>;
    };

    if (!cvLatex?.trim()) {
      return NextResponse.json({ error: "Missing cvLatex." }, { status: 400 });
    }
    if (!section) {
      return NextResponse.json({ error: "Missing section." }, { status: 400 });
    }
    if (!polished || typeof polished !== "object") {
      return NextResponse.json(
        { error: "Missing polished entry." },
        { status: 400 },
      );
    }

    const latex = await completeText({
      tier: "fast",
      maxTokens: 16000,
      system: INSERT_CV_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Insert this entry into the "${section}" section of the CV LaTeX below.

=== NEW ENTRY (structured JSON — translate into LaTeX using the same macros/format as existing entries in this section) ===
${JSON.stringify(polished, null, 2)}

=== EXISTING CV LATEX ===
${cvLatex}

Return the complete updated LaTeX source. No code fences. No commentary.`,
        },
      ],
    });

    return NextResponse.json({ updatedCvLatex: latex });
  } catch (err) {
    console.error("[/api/profile/insert-cv]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
