import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile } from "@/lib/profile";
import { getTemplate } from "@/lib/templates";
import { COMPOSE_TARGET_FRACTION } from "@/lib/latex";
import type { HonestSignals } from "@/lib/prompts/context";
import {
  analysisContextBlock,
  filterMustInclude,
  honestyBlock,
  mergeHonestSignals,
} from "@/lib/prompts/context";
import { BUILD_SYSTEM_PROMPT } from "@/lib/prompts/build";

export const runtime = "nodejs";
export const maxDuration = 300;

// Re-exported so existing client imports from this route keep working.
export type { HonestVerdict, HonestSignals } from "@/lib/prompts/context";

export async function POST(req: NextRequest) {
  try {
    const {
      jobDescription,
      template,
      profileContext,
      analysis,
      honest,
      budget,
      cuts,
    } = (await req.json()) as {
      jobDescription?: string;
      template?: string;
      profileContext?: {
        parsedProfile?: ParsedProfile;
        baseCvLatex?: string;
        additionalSkills?: string;
      };
      analysis?: Analysis;
      honest?: HonestSignals;
      budget?: number;
      cuts?: string[];
    };

    if (!jobDescription?.trim()) {
      return NextResponse.json(
        { error: "Missing jobDescription." },
        { status: 400 },
      );
    }

    const hasProfileContent = !!(
      profileContext?.parsedProfile ||
      profileContext?.baseCvLatex?.trim() ||
      profileContext?.additionalSkills?.trim()
    );
    if (!hasProfileContent) {
      return NextResponse.json(
        {
          error:
            "Profile context required — provide at least parsedProfile, baseCvLatex, or additionalSkills.",
        },
        { status: 400 },
      );
    }

    const templateLatex = template?.trim() || getTemplate().latex;

    const mergedHonest = mergeHonestSignals(honest, analysis);
    const mustIncludePicks = filterMustInclude(
      analysis?.must_include,
      mergedHonest.perKeyword,
    );
    const analysisContext = analysisContextBlock(analysis, mustIncludePicks);
    const honestBlock = honestyBlock(mergedHonest);

    const profileParts: string[] = [];
    if (profileContext?.parsedProfile) {
      profileParts.push(
        `Unified profile (structured JSON — merged from the candidate's resume, CV, and skill notes. Each item lists which source(s) it came from):
${JSON.stringify(profileContext.parsedProfile, null, 2)}`,
      );
    }
    if (profileContext?.baseCvLatex?.trim()) {
      profileParts.push(
        `Base CV (LaTeX — the candidate's comprehensive content store; may contain experience and detail beyond the parsed profile):
${profileContext.baseCvLatex.trim()}`,
      );
    }
    if (profileContext?.additionalSkills?.trim()) {
      profileParts.push(
        `Additional skills / notes (free-form, candidate-provided):
${profileContext.additionalSkills.trim()}`,
      );
    }
    const profileBlock = profileParts.length
      ? `\n=== CANDIDATE PROFILE (content pool — your source of truth) ===
${profileParts.join("\n\n")}
`
      : "";

    const budgetBlock =
      typeof budget === "number" && budget > 0
        ? `\nVISIBLE_CHAR_BUDGET: ${budget}\nTarget: ${Math.round(budget * 0.95)}\n`
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
      system: BUILD_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Build a one-page LaTeX résumé for the candidate, targeted at the job description below, by composing content from the profile into the provided template's layout.

=== JOB DESCRIPTION ===
${jobDescription}
${budgetBlock}${cutsBlock}${analysisContext}${honestBlock}${profileBlock}
=== LATEX TEMPLATE (preserve preamble, packages, custom macros, and section structure; replace all placeholder content with profile material tailored to the JD) ===
${templateLatex}

Return the complete built LaTeX source. No code fences. No commentary.`,
        },
      ],
    });

    return NextResponse.json({ latex });
  } catch (err) {
    console.error("[/api/build]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
