import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile } from "@/lib/profile";
import { COMPOSE_TARGET_FRACTION } from "@/lib/latex";
import type { HonestSignals } from "@/lib/prompts/context";
import {
  analysisContextBlock,
  filterMustInclude,
  honestyBlock,
  mergeHonestSignals,
} from "@/lib/prompts/context";
import { TAILOR_SYSTEM_PROMPT } from "@/lib/prompts/tailor";

export const runtime = "nodejs";
export const maxDuration = 300;

// Re-exported so existing client imports from this route keep working.
export type { HonestVerdict, HonestSignals } from "@/lib/prompts/context";

export async function POST(req: NextRequest) {
  try {
    const {
      resume,
      jobDescription,
      analysis,
      honest,
      profileContext,
      budget,
      cuts,
    } = (await req.json()) as {
      resume?: string;
      jobDescription?: string;
      analysis?: Analysis;
      honest?: HonestSignals;
      profileContext?: {
        parsedProfile?: ParsedProfile;
        baseCvLatex?: string;
        additionalSkills?: string;
      };
      budget?: number;
      cuts?: string[];
    };

    if (!resume?.trim() || !jobDescription?.trim()) {
      return NextResponse.json(
        { error: "Both resume and jobDescription are required." },
        { status: 400 },
      );
    }

    const mergedHonest = mergeHonestSignals(honest, analysis);
    const mustIncludePicks = filterMustInclude(
      analysis?.must_include,
      mergedHonest.perKeyword,
    );
    const analysisContext = analysisContextBlock(analysis, mustIncludePicks);
    const honestBlock = honestyBlock(mergedHonest);

    let profileBlock = "";
    if (profileContext) {
      const parts: string[] = [];
      if (profileContext.parsedProfile) {
        parts.push(
          `Unified profile (structured JSON — merged from the candidate's resume, CV, and additional skills. Each item lists which source(s) it came from):
${JSON.stringify(profileContext.parsedProfile, null, 2)}`,
        );
      } else if (profileContext.baseCvLatex?.trim()) {
        parts.push(
          `Full CV (LaTeX, longer than the resume — may contain experience that wasn't included for length reasons):
${profileContext.baseCvLatex.trim()}`,
        );
      }
      if (profileContext.additionalSkills?.trim()) {
        parts.push(
          `Additional skills/notes (free-form, candidate-provided):
${profileContext.additionalSkills.trim()}`,
        );
      }
      if (parts.length) {
        profileBlock = `\n=== BROADER PROFILE CONTEXT ===\n${parts.join("\n\n")}\n`;
      }
    }

    const budgetBlock =
      typeof budget === "number" && budget > 0
        ? `\n=== VISIBLE_CHAR_BUDGET (HARD CEILING) ===
${budget} visible characters maximum.
Target ~${Math.round(budget * COMPOSE_TARGET_FRACTION)} (${Math.round(COMPOSE_TARGET_FRACTION * 100)}% of budget) to leave safety margin.
Visible characters = everything that renders after stripping LaTeX commands, comments, and braces.
The output's visible-char count will be measured after you respond. Going over forces a re-trim.
`
        : "";

    const cutsBlock =
      cuts && cuts.length > 0
        ? `\n=== CUTS_TO_APPLY (the previous attempt was over budget — apply these) ===
${cuts.map((c, i) => `${i + 1}. ${c}`).join("\n")}
`
        : "";

    const latex = await completeText({
      tier: "primary",
      maxTokens: 16000,
      thinking: true,
      system: TAILOR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Tailor the LaTeX resume below to the job description.

=== JOB DESCRIPTION ===
${jobDescription}
${budgetBlock}${cutsBlock}${analysisContext}${honestBlock}${profileBlock}
=== ORIGINAL RESUME (LaTeX source — this is the document to rewrite) ===
${resume}

Return the complete tailored LaTeX source. No code fences. No commentary.`,
        },
      ],
    });

    return NextResponse.json({ latex });
  } catch (err) {
    console.error("[/api/tailor]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
