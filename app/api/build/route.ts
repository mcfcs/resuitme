import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile } from "@/lib/profile";
import { getTemplate } from "@/lib/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

// 3200 visible chars is approximately what fits on one LaTeX page with
// standard margins and 11pt font (matches our built-in template). Used as a
// server-side fallback when the client doesn't send a budget.
const ONE_PAGE_DEFAULT_BUDGET = 3200;

// Total compose attempts (initial + retries). After this many, we surface
// the closest-to-budget version with a trimWarning flag.
const MAX_BUILD_ATTEMPTS = 3;

// How much over the overshoot we ask the cut generator to cover. Picking 30%
// more buffer absorbs uneven model adherence to cuts.
const CUT_OVERSHOOT_BUFFER = 1.3;

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

Step 7 — Summary: 1-2 qualitative sentences framing the candidate's actual focus areas for THIS JD. No invented numbers. Omit if budget is tight.

Step 8 — Omit empty sections entirely. If the candidate has nothing for Awards, don't include the header.

ONE-PAGE LENGTH CONSTRAINT — INVIOLABLE:
- Your output's visible-character count MUST be ≤ VISIBLE_CHAR_BUDGET. Strict ≤. Not "approximately". Not "around". Strictly less-than-or-equal.
- The character count is measured by stripping all \\commands, comments, %, and {} braces.
- TARGET ~90% of the budget while composing — the headroom absorbs the imprecision of the visible-char count vs. real LaTeX rendering.
- The server will count your visible characters after you respond using this exact method: strip all \\commands, comments (% to end of line), braces {}, then collapse whitespace. The result must be ≤ VISIBLE_CHAR_BUDGET. Design your output knowing this is measured mechanically, not estimated.
- When uncertain: DROP A PROJECT, DROP A BULLET, DROP A SECTION. Never add an item once you're at 85% of budget.
- It is FAR better to drop a moderately-relevant item than to ship a résumé that overshoots by even one bullet. Length compliance is non-negotiable and overrides any other instruction.

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

// Server-side visible-char counter. Mirrors the method described in the
// system prompt: strip comments, then \commands, then braces, then collapse
// whitespace. This is what enforces the budget — not an estimate.
function countVisibleChars(latex: string): number {
  return latex
    .replace(/%.*$/gm, "") // strip comments
    .replace(/\\[a-zA-Z]+\*?/g, "") // strip \commands
    .replace(/[{}]/g, "") // strip braces
    .replace(/\s+/g, " ") // collapse whitespace
    .trim().length;
}

// Strip macro decoration from a captured project heading argument so the cut
// instruction reads cleanly (e.g. "\textbf{Bank Loan...} $|$ \emph{Python}"
// becomes "Bank Loan... | Python").
function cleanCaption(raw: string): string {
  return raw
    .replace(/\\textbf\s*\{([^}]*)\}/g, "$1")
    .replace(/\\emph\s*\{([^}]*)\}/g, "$1")
    .replace(/\\textit\s*\{([^}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?/g, "")
    .replace(/[{}$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Scan latex for \resumeProjectHeading blocks. For each, estimate the visible
// chars it contributes (heading + everything until the next heading or
// \resumeSubHeadingListEnd).
function extractProjects(
  latex: string,
): Array<{ name: string; chars: number }> {
  const headingRegex = /\\resumeProjectHeading\s*\{([^}]+)\}/g;
  const positions: Array<{ raw: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(latex)) !== null) {
    positions.push({ raw: m[1], start: m.index });
  }

  return positions.map((pos, i) => {
    const nextStart =
      i + 1 < positions.length
        ? positions[i + 1].start
        : (() => {
            const endIdx = latex.indexOf(
              "\\resumeSubHeadingListEnd",
              pos.start,
            );
            return endIdx >= 0 ? endIdx : latex.length;
          })();
    return {
      name: cleanCaption(pos.raw) || "(unnamed project)",
      chars: countVisibleChars(latex.slice(pos.start, nextStart)),
    };
  });
}

// Scan latex for \resumeItem bullets and return each one's text + char weight.
function extractBullets(
  latex: string,
): Array<{ text: string; chars: number }> {
  const regex = /\\resumeItem\s*\{([^}]+)\}/g;
  const out: Array<{ text: string; chars: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(latex)) !== null) {
    const text = m[1].trim();
    if (!text) continue;
    out.push({ text, chars: countVisibleChars(text) });
  }
  return out;
}

// Greedy cut generator. Sorts projects + bullets by their visible-char weight
// (largest first) and proposes drops until estimated savings cover the
// overshoot with a 30% buffer. Project drops are preferred — they save more
// per cut than bullet trims do.
function generateCuts(latex: string, overshoot: number): string[] {
  if (overshoot <= 0) return [];
  const target = Math.ceil(overshoot * CUT_OVERSHOOT_BUFFER);

  const projects = extractProjects(latex).sort((a, b) => b.chars - a.chars);
  const bullets = extractBullets(latex).sort((a, b) => b.chars - a.chars);

  const cuts: string[] = [];
  let savings = 0;

  for (const p of projects) {
    if (savings >= target) break;
    cuts.push(`Remove project: ${p.name} (saves ~${p.chars} chars)`);
    savings += p.chars;
  }

  for (const b of bullets) {
    if (savings >= target) break;
    const preview = b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text;
    cuts.push(`Remove bullet: "${preview}" (saves ~${b.chars} chars)`);
    savings += b.chars;
  }

  return cuts;
}

export async function POST(req: NextRequest) {
  try {
    const {
      jobDescription,
      template,
      profileContext,
      analysis,
      honest,
      budget,
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
    const effectiveBudget =
      typeof budget === "number" && budget > 0
        ? budget
        : ONE_PAGE_DEFAULT_BUDGET;

    // Merge analyzer-flagged missing keywords into the honesty map as hard
    // "none" — but only for keywords the user hasn't already given an explicit
    // verdict for.
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

    const budgetBlock = `\nVISIBLE_CHAR_BUDGET: ${effectiveBudget}\nTarget: ${Math.round(effectiveBudget * 0.95)}\n`;

    const client = getAnthropic();

    // ----- Server-side compose loop with retry on overshoot ---------------

    const composeOnce = async (
      cuts: string[],
      previousCount: number,
    ): Promise<string> => {
      const cutsBlock =
        cuts.length > 0
          ? `\n=== CUTS_TO_APPLY (previous attempt was ${previousCount} chars, budget is ${effectiveBudget}, need to cut at least ${Math.max(1, previousCount - effectiveBudget)} chars) ===
${cuts.map((c, i) => `${i + 1}. ${c}`).join("\n")}
`
          : "";

      const userContent = `Build a one-page LaTeX résumé for the candidate, targeted at the job description below, by composing content from the profile into the provided template's layout.

=== JOB DESCRIPTION ===
${jobDescription}
${budgetBlock}${cutsBlock}${analysisContext}${honestBlock}${profileBlock}
=== LATEX TEMPLATE (preserve preamble, packages, custom macros, and section structure; replace all placeholder content with profile material tailored to the JD) ===
${templateLatex}

Return the complete built LaTeX source. No code fences. No commentary.`;

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Model returned no text content.");
      }

      let latex = textBlock.text.trim();
      if (latex.startsWith("```")) {
        latex = latex.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
      }
      return latex;
    };

    let bestLatex = "";
    let bestChars = Number.POSITIVE_INFINITY;
    const cutsAccumulated: string[] = [];
    let nextCuts: string[] = [];
    let previousCount = 0;
    let attempt = 0;

    while (attempt < MAX_BUILD_ATTEMPTS) {
      attempt += 1;
      const latex = await composeOnce(nextCuts, previousCount);
      const chars = countVisibleChars(latex);

      // Track the closest-to-budget version in case all attempts overshoot.
      if (chars < bestChars) {
        bestLatex = latex;
        bestChars = chars;
      }

      if (chars <= effectiveBudget) {
        return NextResponse.json({
          latex,
          visibleChars: chars,
          budget: effectiveBudget,
          iterations: attempt,
          cutsApplied: cutsAccumulated,
          trimWarning: false,
        });
      }

      if (attempt >= MAX_BUILD_ATTEMPTS) break;

      // Build the next round's cuts list against the latest latex.
      const newCuts = generateCuts(latex, chars - effectiveBudget);
      if (newCuts.length === 0) break; // nothing left to propose

      cutsAccumulated.push(...newCuts);
      nextCuts = newCuts;
      previousCount = chars;
    }

    // Loop exhausted without converging — return the closest attempt and flag.
    return NextResponse.json({
      latex: bestLatex,
      visibleChars: bestChars,
      budget: effectiveBudget,
      iterations: attempt,
      cutsApplied: cutsAccumulated,
      trimWarning: bestChars > effectiveBudget,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/build]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
