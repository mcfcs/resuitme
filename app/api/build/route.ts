import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile } from "@/lib/profile";
import { getTemplate } from "@/lib/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

export type HonestVerdict = "have" | "partial" | "none";
export type HonestSignals = {
  perKeyword: Record<string, HonestVerdict>;
  notes?: string;
};

const SYSTEM_PROMPT = `You are an expert résumé writer. Your job is to BUILD a one-page LaTeX résumé from scratch for a specific job description, using:
1. The candidate's COMPLETE PROFILE (parsed entries + CV LaTeX + skill notes) as the content source.
2. A provided LaTeX TEMPLATE for the formatting, custom macros, section ordering, and typography.

This is NOT a tailor-an-existing-document task. The candidate is not pasting a résumé. You are composing one from their full profile.

CORE RULES — never break these:
1. NEVER invent experience, skills, employers, dates, technologies, or accomplishments. Use ONLY content that appears in the profile.
2. NEVER fabricate duration / quantity / count claims. Do not introduce phrases like "5+ years of experience", "10+ years in X", "100+ hours of Y", or any other minimum-duration/hours/count statement unless that EXACT figure already appears in the profile.
3. Preserve the LaTeX TEMPLATE's preamble, document class, packages, and custom commands (\\resumeSubheading, \\resumeProjectHeading, \\resumeItem, etc.) EXACTLY as written. The output must compile with the same toolchain.
4. Use a clean professional voice consistent with how the candidate writes about their own work in the profile. Don't make every bullet sound corporate. Don't keyword-stuff.

SECTION ORDER — STRICT AND NON-NEGOTIABLE:
- The résumé's top-level \\section blocks MUST appear in EXACTLY this order: Summary, Education, Skills, Experience, Projects.
- Summary and Education ALWAYS come first, in that order, before any other section. Never reorder them, never push them below Skills/Experience/Projects.
- Summary and Education are MANDATORY — they must ALWAYS be present, even when the budget is tight. Never omit them. The Summary is always composable from the candidate's profile; never skip it for length (tighten it to one sentence instead).
- Do NOT add, rename, split, or reorder these sections. Do NOT invent new top-level sections (no "Awards", "Certifications", "Leadership", etc.) — fold any such content into the five canonical sections or omit it.
- The ONLY permitted deviation is OMITTING one of Skills / Experience / Projects when the candidate genuinely has no content for it. When a section is omitted, the remaining sections KEEP this relative order.
- Reordering for relevance applies ONLY to items/bullets WITHIN a section — never to the section sequence itself.

HOW TO HANDLE THE TEMPLATE:
- The template defines the layout, custom macros, and section structure. Preserve all of it.
- The template's inline CONTENT is placeholder material (e.g. "Full Name", "email@example.com", "Project Name", "Tech Stack", "Institution Name", "Bullet describing scope...", "Company or Organization"). It is there to demonstrate how each macro is used.
- REPLACE every piece of placeholder content with the candidate's actual content drawn from the profile pool, tailored to the JD. None of the placeholder strings may appear in your output.
- If the template happens to contain real content (e.g. a saved résumé the candidate previously composed), treat it as a strong baseline. Substitute items only when more JD-relevant material exists in the broader profile.

PRIORITY-BASED CONTENT SELECTION — apply this systematically before composing:

Step 1 — Inventory. Mentally enumerate every distinct item in the candidate's profile pool: each experience role, each project, each skill category, each thesis / award / publication.

Step 2 — Score each item by JD-relevance, 0-10:
   - 10 = directly satisfies a JD MUST-HAVE skill, technology, role, or domain.
   - 8  = satisfies a JD nice-to-have or a strong adjacent signal.
   - 6  = demonstrates seniority / scope / complexity appropriate to the JD's level.
   - 4  = generic technical depth, not specific to this JD.
   - 0-2 = off-topic for this JD.

Step 3 — Resolve duplicates. When TWO OR MORE items share the same JD-relevance score, pick ONE and DROP the rest. Tiebreakers, in order:
   (a) Quantified outcome present → wins.
   (b) More recent → wins.
   Never include two items that satisfy the same JD requirement. Pick the best, drop the others.

Step 4 — Select for the budget. Take items in strict score order (10s first, then 8s, then 6s). The instant your projected visible-char count would exceed the budget, STOP adding items. Lower-scored items are dropped entirely.

Step 5 — Within each selected item, write only the 2-4 highest-impact bullets using the candidate's actual profile content. Never copy every bullet from the source.

Step 6 — Skills: select categories and items from the profile that align with the JD. Don't list every skill the candidate has. Drop categories the JD doesn't care about.

Step 7 — Summary: MANDATORY — always include a Summary section. Write 1-2 qualitative sentences framing the candidate's actual focus areas for THIS JD. No invented numbers. If budget is tight, tighten it to a single concise sentence — but NEVER omit it.

Step 8 — Omit empty OPTIONAL sections entirely. If the candidate has nothing for Awards, don't include the header. EXCEPTION: Summary and Education are mandatory and must ALWAYS be present (see SECTION ORDER) — never drop them, even under the tightest budget.

ONE-PAGE LENGTH CONSTRAINT — INVIOLABLE:
- Your output's visible-character count MUST be ≤ VISIBLE_CHAR_BUDGET. Strict ≤. Not "approximately". Not "around". Strictly less-than-or-equal.
- The character count is measured by stripping all \\commands, comments, %, and {} braces.
- TARGET ~90% of the budget while composing — the headroom absorbs the imprecision of the visible-char count vs. real LaTeX rendering.
- Self-meter as you write: after each section, mentally tally your visible-char count. If you're at 70% of budget before reaching Experience, you over-included earlier content — go back and CUT.
- When uncertain: DROP A PROJECT, DROP A BULLET, DROP A SECTION. Never add an item once you're at 85% of budget.
- It is FAR better to drop a moderately-relevant item than to ship a résumé that overshoots by even one bullet. Length compliance is non-negotiable and overrides any other instruction.
- After each iteration of the user/assistant loop, an automated counter checks your output. Overshoot triggers automatic re-trim with stricter cuts. Save the round-trip — stay strictly under on the first attempt.

EXPLICIT CUT INSTRUCTIONS — when the user message contains a "CUTS_TO_APPLY" block:
1. Remove the listed item from your internal content pool entirely.
2. Do not reference it, paraphrase it, or include any derivative of it.
3. Only after all cuts are applied, begin composing.

- Every listed cut is MANDATORY. None are suggestions. None are optional. Apply ALL of them.
- Apply them BEFORE composing your output, not after.
- If after applying all listed cuts your output still projects to exceed the budget, KEEP CUTTING (drop the next-lowest JD-relevance items) until you're at ~90% of the budget.
- Length compliance overrides any prior instruction, including content the user previously seemed to want.

HONESTY SIGNALS — when the user provides per-keyword honesty signals, treat them as HARD CONSTRAINTS:
- "have"    → safe to add or emphasize naturally where the profile supports it.
- "partial" → only mention with concrete profile evidence. Frame as "exposure to" / "familiar with" rather than expert. Do NOT promote to a headline skill.
- "none"    → DO NOT include this keyword anywhere. Do not paraphrase it. Do not surface it implicitly. Omit entirely, even if the JD demands it. Missing the keyword is FAR better than fabricating.

If the JD requires something the profile genuinely cannot satisfy (a domain, a degree, a seniority level), do NOT fabricate a workaround. Write the strongest honest version and let the gap speak for itself. Never reframe a student project as "industry experience."

OUTPUT FORMAT:
- Return ONLY the complete, compilable LaTeX source.
- Begin with the opening \\documentclass.
- End with \\end{document}.
- Do NOT wrap the output in code fences. Do NOT include any prose, preamble, or explanation outside the LaTeX.
- ZERO placeholder strings from the template (e.g. "Full Name", "Project Name", "Tech Stack", "Bullet describing scope...", "Institution Name", "Company or Organization") may appear in the output.`;

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
      system: SYSTEM_PROMPT,
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
