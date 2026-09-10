import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile } from "@/lib/profile";
import { getTemplate } from "@/lib/templates";
import { layoutContractBlock } from "@/lib/prompts/layout-contract";
import { COMPOSE_TARGET_FRACTION } from "@/lib/latex";
import type { HonestSignals } from "@/lib/prompts/context";
import {
  analysisContextBlock,
  filterMustInclude,
  fitStrategyBlock,
  honestyBlock,
  mergeHonestSignals,
} from "@/lib/prompts/context";
import { BUILD_SYSTEM_PROMPT } from "@/lib/prompts/build";
import {
  findUngroundedNumbers,
  type NumericClaim,
} from "@/lib/ats/number-check";

export const runtime = "nodejs";
export const maxDuration = 300;

// Re-exported so existing client imports from this route keep working.
export type { HonestVerdict, HonestSignals } from "@/lib/prompts/context";

/**
 * Names the figures the previous draft invented, so the retry cannot reuse
 * them. Deliberately does NOT say "add a different number" — the correct fix
 * is almost always to state the achievement without a quantity.
 */
function ungroundedNumbersBlock(claims: NumericClaim[] | undefined): string {
  if (!claims?.length) return "";
  return `
=== FABRICATED FIGURES (your previous draft invented these — remove them) ===
${claims.map((c, i) => `${i + 1}. "${c.raw}" in: ${c.context}`).join("\n")}

None of these numbers appear anywhere in the candidate's profile. You invented
them. Rewrite each of those statements WITHOUT the figure — describe what was
actually done and drop the quantity. Do not substitute a different number, and
do not invent figures anywhere else: every digit you write must be traceable to
the profile above.
`;
}

export async function POST(req: NextRequest) {
  try {
    const {
      jobDescription,
      template,
      templateId,
      profileContext,
      analysis,
      honest,
      budget,
      cuts,
      additions,
    } = (await req.json()) as {
      jobDescription?: string;
      template?: string;
      templateId?: string;
      profileContext?: {
        parsedProfile?: ParsedProfile;
        baseCvLatex?: string;
        additionalSkills?: string;
      };
      analysis?: Analysis;
      honest?: HonestSignals;
      budget?: number;
      cuts?: string[];
      /** Quote-verified instructions from the expand planner. */
      additions?: string[];
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

    // A raw template string (the user's own saved résumé LaTeX) takes precedence
    // over the chosen built-in. Crucially, the LAYOUT CONTRACT is derived ONLY
    // for a built-in: when the user brings their own LaTeX we do not know its
    // section order or macros, and asserting Classic's would corrupt the output.
    const chosen = getTemplate(templateId);
    const usingOwnLatex = Boolean(template?.trim());
    const templateLatex = usingOwnLatex ? template!.trim() : chosen.latex;
    const layoutContract = usingOwnLatex ? "" : layoutContractBlock(chosen);

    const mergedHonest = mergeHonestSignals(honest, analysis);
    const mustIncludePicks = filterMustInclude(
      analysis?.must_include,
      mergedHonest.perKeyword,
      analysis?.fit?.disqualifying ?? [],
    );
    const fitBlock = fitStrategyBlock(analysis?.fit);
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
        ? `\nVISIBLE_CHAR_BUDGET: ${budget}\nTarget: ${Math.round(budget * COMPOSE_TARGET_FRACTION)}\n`
        : "";

    const additionsBlock =
      additions && additions.length > 0
        ? `
=== ADDITIONS_TO_APPLY (the previous draft left the page underfilled) ===
Each instruction below names real material from the candidate's own profile,
already verified against it. Apply every one.

${additions.map((a, i) => `${i + 1}. ${a}`).join("\n")}

These are the ONLY new material you may add. Do not invent anything beyond
them, and do not pad. The visible-character ceiling above still binds — if
applying all of them would exceed it, apply the highest-value ones and stop.
`
        : "";

    const cutsBlock =
      cuts && cuts.length > 0
        ? `\n=== CUTS_TO_APPLY (the previous attempt was over budget — apply these) ===
${cuts.map((c, i) => `${i + 1}. ${c}`).join("\n")}
`
        : "";

    // The candidate's own material, and the ONLY thing a figure may be drawn
    // from. Same pool the model composes off, so anything it may legitimately
    // write is in here.
    const numericPool = [
      profileParts.join("\n\n"),
      analysisContext,
      additions?.join("\n") ?? "",
    ].join("\n\n");

    const generate = (forbidden?: NumericClaim[]) =>
      completeText({
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
${budgetBlock}${cutsBlock}${additionsBlock}${ungroundedNumbersBlock(forbidden)}${analysisContext}${fitBlock}${honestBlock}${profileBlock}${layoutContract}
=== LATEX TEMPLATE (preserve preamble, packages, custom macros, and section structure; replace all placeholder content with profile material tailored to the JD) ===
${templateLatex}

Return the complete built LaTeX source. No code fences. No commentary.`,
          },
        ],
      });

    const latex = await generate();

    // --- numeric honesty gate --------------------------------------------
    // A quantity the profile does not support is fabrication, and unlike a
    // disclaimed keyword nothing else catches it: measured, the model turned
    // "maximize margins and inventory turnover" into "boosting inventory
    // turnover by 15%". Regenerate ONCE naming the offenders, then keep
    // whichever draft invents less — never a draft that invents more.
    const ungrounded = findUngroundedNumbers(latex, numericPool);
    if (ungrounded.length === 0) {
      return NextResponse.json({ latex });
    }

    console.warn(
      "[/api/build] ungrounded figures, regenerating:",
      ungrounded.map((c) => c.raw),
    );

    let retry: string;
    try {
      retry = await generate(ungrounded);
    } catch (err) {
      // A failed retry must never lose a usable draft.
      console.error(
        "[/api/build] regeneration failed, keeping first draft",
        err,
      );
      return NextResponse.json({ latex, ungroundedNumbers: ungrounded.length });
    }

    const retryUngrounded = findUngroundedNumbers(retry, numericPool);
    const improved = retryUngrounded.length < ungrounded.length;

    return NextResponse.json({
      latex: improved ? retry : latex,
      ungroundedNumbers: improved ? retryUngrounded.length : ungrounded.length,
      numericRetry: true,
    });
  } catch (err) {
    console.error("[/api/build]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
