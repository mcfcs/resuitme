import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";
import type { Analysis } from "@/lib/types";
import type { ParsedProfile, ProfileMetric } from "@/lib/profile";
import { metricsToText } from "@/lib/profile";
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
  stripUngroundedNumbers,
  type NumericClaim,
} from "@/lib/ats/number-check";
import {
  findUngroundedClaims,
  softenClaims,
  type SoftenedClaim,
  type UngroundedClaim,
} from "@/lib/ats/claim-check";

export const runtime = "nodejs";
export const maxDuration = 300;

// Re-exported so existing client imports from this route keep working.
export type { HonestVerdict, HonestSignals } from "@/lib/prompts/context";
export type { SoftenedClaim } from "@/lib/ats/claim-check";

/** What /api/build returns on success. */
export type BuildResponse = {
  latex: string;
  /**
   * Everything the model first wrote that the candidate's material does not
   * support, and how it left the page. Absent when the first draft was clean.
   */
  softened?: SoftenedClaim[];
  /** Invented figures still on the page: no removal rule applied safely. */
  ungroundedNumbers?: number;
  /** True when a second draft was requested. */
  honestyRetry?: boolean;
};

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

/**
 * Names the qualitative claims the previous draft asserted without support.
 * Same shape as the figures block, and the same instruction: restate without
 * the claim, never with a synonym for it.
 */
function ungroundedClaimsBlock(claims: UngroundedClaim[] | undefined): string {
  if (!claims?.length) return "";
  return `
=== UNSUPPORTED CLAIMS (your previous draft asserted these — the profile does not) ===
${claims.map((c, i) => `${i + 1}. "${c.raw}" (${c.kind}) in: ${c.context}`).join("\n")}

The candidate's profile does not state any of these. Restate each of those
bullets WITHOUT the claim, in the profile's own terms: what was actually done,
not who led it, how big it was, how senior the role was or how long it ran.
Do not substitute a synonym ("spearheaded" for "led", "large-scale" for "at
scale"), and do not assert leadership, scale, seniority or duration anywhere
else unless the profile states it in so many words.
`;
}

type Gate = { numbers: NumericClaim[]; claims: UngroundedClaim[] };

/** True when `b` invents no more of either kind than `a`, and less of one. */
function improvedOn(a: Gate, b: Gate): boolean {
  const noWorse =
    b.numbers.length <= a.numbers.length && b.claims.length <= a.claims.length;
  const better =
    b.numbers.length < a.numbers.length || b.claims.length < a.claims.length;
  return noWorse && better;
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
        /** Figures and claims the candidate has confirmed as their own. */
        metrics?: ProfileMetric[];
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
    // Figures and claims the candidate asserted themselves, in the metrics
    // panel. Grounded by assertion: they are the candidate's own words, so
    // they join the pool the gates check against and the pool the model
    // composes from — a confirmed metric is never re-flagged.
    const metricsText = metricsToText(profileContext?.metrics);
    if (metricsText) {
      profileParts.push(
        `Candidate-confirmed figures and claims (stated by the candidate; use them where they fit):
${metricsText}`,
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

    // The candidate's own words, and nothing else. This is what a qualitative
    // claim must be grounded in: the analysis and the expand instructions are
    // model-written, and a model-written "led the team" grounding another
    // model-written "led the team" is exactly the loop this gate exists to
    // break.
    const claimPool = profileParts.join("\n\n");

    // Figures may additionally come from the analysis context (the analyzer
    // quotes the candidate's own figures back) and the quote-verified
    // additions. Same pool the model composes off, so anything it may
    // legitimately write is in here.
    const numericPool = [
      claimPool,
      analysisContext,
      additions?.join("\n") ?? "",
    ].join("\n\n");

    const generate = (forbidden?: Gate) =>
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
${budgetBlock}${cutsBlock}${additionsBlock}${ungroundedNumbersBlock(forbidden?.numbers)}${ungroundedClaimsBlock(forbidden?.claims)}${analysisContext}${fitBlock}${honestBlock}${profileBlock}${layoutContract}
=== LATEX TEMPLATE (preserve preamble, packages, custom macros, and section structure; replace all placeholder content with profile material tailored to the JD) ===
${templateLatex}

Return the complete built LaTeX source. No code fences. No commentary.`,
          },
        ],
      });

    const gate = (draft: string): Gate => ({
      numbers: findUngroundedNumbers(draft, numericPool),
      claims: findUngroundedClaims(draft, claimPool),
    });

    const first = await generate();

    // --- honesty gate -----------------------------------------------------
    // A quantity or a quality the profile does not support is fabrication,
    // and unlike a disclaimed keyword nothing else catches it: measured, the
    // model turned "maximize margins and inventory turnover" into "boosting
    // inventory turnover by 15%", and wrote "led a team" for candidates who
    // never claimed one. Regenerate ONCE naming every offender, keep
    // whichever draft invents less — never a draft that invents more — and
    // then strip in code whatever survived, because a prompt can only ask.
    const firstGate = gate(first);
    if (firstGate.numbers.length === 0 && firstGate.claims.length === 0) {
      return NextResponse.json({ latex: first } satisfies BuildResponse);
    }

    console.warn("[/api/build] ungrounded, regenerating:", {
      figures: firstGate.numbers.map((c) => c.raw),
      claims: firstGate.claims.map((c) => `${c.kind}:${c.raw}`),
    });

    let draft = first;
    let draftGate = firstGate;
    try {
      const retry = await generate(firstGate);
      const retryGate = gate(retry);
      if (improvedOn(firstGate, retryGate)) {
        draft = retry;
        draftGate = retryGate;
      }
    } catch (err) {
      // A failed retry must never lose a usable draft.
      console.error(
        "[/api/build] regeneration failed, keeping first draft",
        err,
      );
    }

    // What the retry took care of: in the first draft, not in the chosen one.
    // Same raw text in the same bullet means the claim survived untouched.
    const rewrittenClaims = firstGate.claims.filter(
      (c) =>
        !draftGate.claims.some(
          (d) => d.raw === c.raw && d.context === c.context,
        ),
    );
    const rewrittenNumbers = firstGate.numbers.filter(
      (c) =>
        !draftGate.numbers.some(
          (d) => d.raw === c.raw && d.context === c.context,
        ),
    );

    // --- the backstop -----------------------------------------------------
    const claimStrip = softenClaims(draft, claimPool);
    const numberStrip = stripUngroundedNumbers(claimStrip.latex, numericPool);

    if (numberStrip.residual.length) {
      console.warn(
        "[/api/build] invented figures still on the page:",
        numberStrip.residual.map((c) => c.raw),
      );
    }

    const softened: SoftenedClaim[] = [
      ...rewrittenClaims.map((c): SoftenedClaim => ({
        claim: c.raw,
        kind: c.kind,
        bullet: c.context,
        how: "rewritten",
      })),
      ...rewrittenNumbers.map((c): SoftenedClaim => ({
        claim: c.raw,
        kind: "figure",
        bullet: c.context,
        how: "rewritten",
      })),
      ...claimStrip.softened,
      ...numberStrip.stripped.map((c): SoftenedClaim => ({
        claim: c.raw,
        kind: "figure",
        bullet: c.context,
        how: "stripped",
      })),
    ];

    return NextResponse.json({
      latex: numberStrip.latex,
      softened,
      ungroundedNumbers: numberStrip.residual.length,
      honestyRetry: true,
    } satisfies BuildResponse);
  } catch (err) {
    console.error("[/api/build]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
