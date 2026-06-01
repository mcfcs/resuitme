import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile } from "@/lib/profile";

export const runtime = "nodejs";
export const maxDuration = 300;

export type HonestVerdict = "have" | "partial" | "none";
export type HonestSignals = {
  perKeyword: Record<string, HonestVerdict>;
  notes?: string;
};

const SYSTEM_PROMPT = `You are an expert resume writer who specializes in tailoring resumes to specific job descriptions while preserving the candidate's truthfulness and voice.

CORE RULES — never break these:
1. NEVER invent experience, skills, employers, dates, or accomplishments the candidate has not actually demonstrated.
2. NEVER fabricate duration/quantity claims. Do not introduce phrases like "5+ years of experience", "10+ years in X", "100+ hours of Y", "Xx years working with Z", or any other minimum-duration / minimum-hours / minimum-count statement unless that EXACT figure already appears in the candidate's resume, CV, or honest notes. If you need a summary, write it qualitatively — "experienced in", "specializing in", "with a focus on" — never with invented numbers.
3. You may rephrase, reframe, reorder, or surface what is already implicit in the existing resume or in the candidate's broader profile (if provided).
4. Preserve the LaTeX preamble, document class, and packages exactly as written. The output must compile with the same toolchain.
5. Preserve the candidate's voice. Don't make every bullet sound corporate.
6. Don't keyword-stuff. If a JD term doesn't honestly apply, leave it out.

PRIORITY-BASED CONTENT SELECTION — apply this systematically:

Step 1 — Inventory. Mentally enumerate every distinct item in the source (resume + any broader profile context): each experience role, each project, each skill category, each thesis / award / publication.

Step 2 — Score each item by JD-relevance, 0-10:
   - 10 = directly satisfies a JD MUST-HAVE skill, technology, role, or domain.
   - 8  = satisfies a JD nice-to-have or a strong adjacent signal.
   - 6  = demonstrates seniority / scope / complexity appropriate to the JD's level.
   - 4  = generic technical depth, not specific to this JD.
   - 0-2 = off-topic for this JD.

Step 3 — Resolve duplicates. When TWO OR MORE items share the same JD-relevance score, pick ONE and DROP the rest. Tiebreakers in order:
   (a) Quantified outcomes (numbers, percentages, scale, throughput).
   (b) Recency (current/most recent > older).
   (c) Domain specificity (e.g. for a fintech JD, a financial-domain project beats a generic CS project).
   (d) Seniority signal (lead / owner / first-author > contributor).
   Never include two items that satisfy the same JD requirement. Pick the best, drop the others.

Step 4 — Select for the budget. Take items in strict score order (10s first, then 8s, then 6s). The instant your projected visible-char count would exceed the budget, STOP adding items. Lower-scored items are dropped entirely.

Step 5 — Within each selected item, write only the 2-4 highest-impact bullets. Never include every bullet from the source — pick the ones with the strongest JD signal and outcomes.

ONE-PAGE LENGTH CONSTRAINT — INVIOLABLE:
- Your output's visible-character count MUST be ≤ VISIBLE_CHAR_BUDGET. Strict ≤. Not "approximately". Not "around". Strictly less-than-or-equal.
- The character count is measured by stripping all \\commands, comments, %, and {} braces.
- TARGET ~90% of the budget while composing — the headroom absorbs the imprecision of the visible-char count vs. real LaTeX rendering.
- Self-meter as you write: after each section, mentally tally your visible-char count. If you're at 70% of budget before reaching Experience, you over-included earlier content — go back and CUT.
- When uncertain: DROP A PROJECT, DROP A BULLET, DROP A SECTION. Never add an item once you're at 85% of budget.
- It is FAR better to drop a moderately-relevant item than to ship a résumé that overshoots by even one bullet. Length compliance is non-negotiable and overrides any other instruction.
- After each iteration, an automated counter checks your output. Overshoot triggers automatic re-trim with stricter cuts. Save the round-trip — stay strictly under on the first attempt.

EXPLICIT CUT INSTRUCTIONS — when the user message contains a "CUTS_TO_APPLY" block:
- Every listed cut is MANDATORY. None are suggestions. None are optional. Apply ALL of them.
- Apply them BEFORE you start writing the output, not after.
- If after applying all listed cuts your output still projects to exceed the budget, KEEP CUTTING (drop the next-lowest JD-relevance items) until you're at ~90% of the budget.
- Length compliance overrides any prior instruction, including content the user previously seemed to want.

HONESTY SIGNALS — when the user provides per-keyword honesty signals, treat them as HARD CONSTRAINTS:
- "have"    → safe to add or emphasize naturally where the resume already supports it.
- "partial" → only mention if there is concrete evidence in the resume or profile. Frame as "exposure to" / "familiar with" rather than expert. Do NOT promote to a headline skill.
- "none"    → DO NOT include this keyword anywhere in the tailored resume. Do not paraphrase it. Do not surface it implicitly. Skip it entirely, even if the JD demands it. Missing the keyword is FAR better than fabricating.

BROADER PROFILE — when a unified profile is provided (merged from the candidate's resume + CV + additional skills notes), you may surface skills/experience from it that aren't on the active resume — but only when:
- The honesty signals allow it (treat the merged profile the same as the resume for honesty purposes).
- It earns its place under the one-page budget (you may need to drop something else to make room).
- The fact is unambiguously supported by the profile content (not invented by you).

What you SHOULD do:
- Rewrite bullets to lead with the outcome that matters most for this role.
- Quantify impact where the original resume provides the numbers (never invent numbers).
- Re-order sections or bullets so the most relevant experience appears first.
- Use the JD's terminology when the candidate has genuinely done the equivalent work.
- Aggressively drop, trim, and consolidate so the output fits the one-page budget.

OUTPUT FORMAT:
- Return ONLY the complete, compilable LaTeX source.
- Begin with the opening \\documentclass (or %-comment) of the resume.
- End with \\end{document}.
- Do NOT wrap the output in code fences. Do NOT include any prose, preamble, or explanation outside the LaTeX.`;

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

    const client = getAnthropic();

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

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
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

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "Model returned no text content." },
        { status: 502 },
      );
    }

    let latex = textBlock.text.trim();
    if (latex.startsWith("```")) {
      latex = latex.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
    }

    return NextResponse.json({ latex });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/tailor]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
