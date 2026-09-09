import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile } from "@/lib/profile";
import { getTemplate } from "@/lib/templates";
import { BUILD_SYSTEM_PROMPT } from "@/lib/prompts/build";

export const runtime = "nodejs";
export const maxDuration = 300;

export type HonestVerdict = "have" | "partial" | "none";
export type HonestSignals = {
  perKeyword: Record<string, HonestVerdict>;
  notes?: string;
};

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

    // Merge analyzer-flagged missing keywords into the honesty map as hard
    // "none" — but only for keywords the user hasn't already given an explicit
    // verdict for. This treats the analyzer's gap signal as a hard block in
    // the builder rather than a soft suggestion.
    const mergedHonest: HonestSignals = honest
      ? { ...honest, perKeyword: { ...honest.perKeyword } }
      : { perKeyword: {} };
    if (analysis?.keyword_coverage?.missing) {
      for (const kw of analysis.keyword_coverage.missing) {
        if (!(kw in mergedHonest.perKeyword)) {
          mergedHonest.perKeyword[kw] = "none";
        }
      }
    }

    const analysisContext = analysis
      ? `\n=== PRIOR ANALYSIS (for prioritization, not for fabrication) ===
Score: ${analysis.score}/100
Verdict: ${analysis.verdict}
Top gaps: ${analysis.gaps.join("; ")}
Missing keywords: ${analysis.keyword_coverage.missing.join(", ")}
Suggested edits: ${analysis.suggestions.join("; ")}
`
      : "";

    let honestBlock = "";
    {
      const have: string[] = [];
      const partial: string[] = [];
      const none: string[] = [];
      for (const [k, v] of Object.entries(mergedHonest.perKeyword)) {
        if (v === "have") have.push(k);
        else if (v === "partial") partial.push(k);
        else if (v === "none") none.push(k);
      }
      if (have.length + partial.length + none.length > 0) {
        honestBlock = `\n=== HONESTY SIGNALS (HARD CONSTRAINTS — apply strictly) ===
Skills/keywords the candidate HAS (safe to emphasize): ${have.length ? have.join(", ") : "(none specified)"}
Skills/keywords the candidate has PARTIAL/limited experience with (only mention if evidence exists, never as headline expertise): ${partial.length ? partial.join(", ") : "(none specified)"}
Skills/keywords the candidate DOES NOT HAVE (NEVER include, NEVER paraphrase, omit entirely): ${none.length ? none.join(", ") : "(none specified)"}
${mergedHonest.notes?.trim() ? `Candidate's notes about their experience: ${mergedHonest.notes.trim()}` : ""}
`;
      }
    }

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
