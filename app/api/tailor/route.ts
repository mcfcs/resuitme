import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile } from "@/lib/profile";
import { TAILOR_SYSTEM_PROMPT } from "@/lib/prompts/tailor";

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

    const analysisContext = analysis
      ? `\n=== PRIOR ANALYSIS (for prioritization, not for fabrication) ===
Score: ${analysis.score}/100
Verdict: ${analysis.verdict}
Top gaps: ${analysis.gaps.join("; ")}
Missing keywords: ${analysis.keyword_coverage.missing.join(", ")}
Suggested edits: ${analysis.suggestions.join("; ")}
`
      : "";

    // Merge analyzer-flagged missing keywords into the honesty map as hard
    // "none" — but only for keywords the user hasn't already given an explicit
    // verdict for. Mirrors /api/build so both flows treat analyzer-detected
    // gaps as a hard block rather than a soft suggestion.
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
Target ~${Math.round(budget * 0.95)} (95% of budget) to leave safety margin.
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
