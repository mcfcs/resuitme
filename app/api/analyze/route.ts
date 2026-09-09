import { NextRequest, NextResponse } from "next/server";
import { completeJson, llmErrorResponse } from "@/lib/llm";
import { ANALYSIS_SCHEMA, Analysis } from "@/lib/types";
import { ANALYZE_SYSTEM_PROMPT } from "@/lib/prompts/analyze";

export const runtime = "nodejs";
export const maxDuration = 300;

export type AnalyzeInputKind = "resume" | "profile";

export async function POST(req: NextRequest) {
  try {
    const { resume, jobDescription, inputKind } = (await req.json()) as {
      resume?: string;
      jobDescription?: string;
      inputKind?: AnalyzeInputKind;
    };

    if (!resume?.trim() || !jobDescription?.trim()) {
      return NextResponse.json(
        { error: "Both resume and jobDescription are required." },
        { status: 400 },
      );
    }

    const kind: AnalyzeInputKind = inputKind === "profile" ? "profile" : "resume";
    const sectionLabel =
      kind === "profile"
        ? "CANDIDATE PROFILE / CV (full background)"
        : "RÉSUMÉ (LaTeX source)";

    const parsed = await completeJson<Analysis>({
      tier: "primary",
      maxTokens: 16000,
      thinking: true,
      system: ANALYZE_SYSTEM_PROMPT,
      schema: ANALYSIS_SCHEMA,
      messages: [
        {
          role: "user",
          content: `Input kind: ${kind}

Evaluate this ${kind === "profile" ? "candidate profile" : "résumé"} against the job description below.

=== JOB DESCRIPTION ===
${jobDescription}

=== ${sectionLabel} ===
${resume}

Return a JSON evaluation matching the schema.`,
        },
      ],
    });

    return NextResponse.json({ analysis: parsed });
  } catch (err) {
    console.error("[/api/analyze]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
