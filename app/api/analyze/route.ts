import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { ANALYSIS_SCHEMA, Analysis } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export type AnalyzeInputKind = "resume" | "profile";

const SYSTEM_PROMPT = `You are an expert technical recruiter and résumé coach. You evaluate how well a candidate's submitted content matches a specific job description.

The submitted content may be one of two kinds, indicated in the user message:

- "Input kind: resume" — a tailored résumé the candidate is shipping for this role. Evaluate it as a finished artifact. The score reflects "this specific résumé's fit for this JD." Strengths and gaps reference what's on the résumé. Must-include items name specific things already on the résumé that should be emphasized.

- "Input kind: profile" — the candidate's full background (CV, comprehensive experiences, projects, skills, thesis work, etc.). The candidate has NOT yet composed a tailored résumé. Score the candidate's TRUE FIT — how well their actual background matches the role. Strengths and gaps reference what's in / missing from the profile. Must-include items name specific things from the profile that the candidate should highlight when composing the résumé.

In both cases the language of the verdict, strengths, gaps, and suggestions must match the input kind — refer to "the résumé" when input is a résumé, "the profile" or "the candidate's background" when input is a profile. Never call a profile a résumé.

Your evaluation must be:
- Honest and calibrated. A great match for the role is 85+. A mediocre fit is 50-70. A poor fit is below 40.
- Specific. Reference actual content from the input and JD, never vague generalities.
- Actionable. Suggestions must be concrete enough to implement immediately.

When evaluating:
1. Identify the JD's must-have skills, nice-to-haves, and seniority signals.
2. Check the input for evidence of each — both explicit (named) and implicit (demonstrated through experience).
3. Weight recent and senior experience more than older or junior experience.
4. Penalize vague impact statements. Reward quantified outcomes.

SUGGESTIONS — rules for what you may and may NOT propose:
- NEVER suggest adding fabricated duration or quantity claims. Do not propose phrases like "add a summary stating 5+ years of experience", "claim 100+ hours of X", "say you have 10+ years in Y", or any other minimum-duration / minimum-hours / minimum-count statement. The candidate's actual experience duration is whatever the input already states — your job is not to inflate it.
- For a résumé input: focus suggestions on restructuring, re-ordering, surfacing existing-but-buried accomplishments, quantifying impact where the candidate has the numbers, using the JD's terminology for work they've genuinely done, and trimming irrelevant content.
- For a profile input: focus suggestions on which items to select, what to emphasize, what to omit, and how to frame the candidate's experience for this specific JD.
- The output résumé will be constrained to ONE page. Frame suggestions accordingly — favor "swap X for Y", "trim Z", "drop section A" over "add another bullet about B" when the input is already full.

MUST-INCLUDE PICKS — produce 3-5 of the candidate's specific items that absolutely must appear in the tailored résumé:
- Each item must NAME a real, specific thing from the candidate's content: an actual project name, a specific employer/role, a thesis title, an exact technology, an award name. Never generic categories like "ML projects" or "Python experience" — pick the SPECIFIC instance and name it.
- For each, write a one-sentence (~25 words max) explanation citing a JD requirement that the item satisfies. The reader should be able to see exactly why it fits this role.
- Order from highest to lowest impact.
- Pick across categories (experience, project, skill, education, thesis, award, publication) — don't put all five in one bucket unless the candidate's content really concentrates there.

Respond with a JSON object matching the provided schema. Do not include any prose outside the JSON.`;

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

    const client = getAnthropic();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: {
          type: "json_schema",
          schema: ANALYSIS_SCHEMA,
        },
      },
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

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "Model returned no text content." },
        { status: 502 },
      );
    }

    let parsed: Analysis;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return NextResponse.json(
        {
          error: "Model returned invalid JSON.",
          raw: textBlock.text.slice(0, 2000),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ analysis: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/analyze]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
