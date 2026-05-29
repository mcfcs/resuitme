import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import { ANALYSIS_SCHEMA, Analysis } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are an expert technical recruiter and resume coach. You evaluate how well a candidate's resume matches a specific job description.

Your evaluation must be:
- Honest and calibrated. A great resume for the role is 85+. A mediocre fit is 50-70. A poor fit is below 40.
- Specific. Reference actual content from the resume and JD, never vague generalities.
- Actionable. Suggestions must be concrete enough that the candidate could implement them immediately.

When evaluating:
1. Identify the JD's must-have skills, nice-to-haves, and seniority signals.
2. Check the resume for evidence of each — both explicit (named) and implicit (demonstrated through experience).
3. Weight recent and senior experience more than older or junior experience.
4. Penalize vague impact statements. Reward quantified outcomes.

SUGGESTIONS — rules for what you may and may NOT propose:
- NEVER suggest adding fabricated duration or quantity claims. Do not propose phrases like "add a summary stating 5+ years of experience", "claim 100+ hours of X", "say you have 10+ years in Y", or any other minimum-duration / minimum-hours / minimum-count statement. The candidate's actual experience duration is whatever their resume already states — your job is not to inflate it.
- Suggestions should focus on: restructuring or re-ordering content, surfacing existing-but-buried accomplishments, quantifying impact where the candidate has the numbers, using the JD's terminology for work they've genuinely done, and trimming irrelevant content.
- The tailored output will be constrained to ONE page. Frame suggestions accordingly — favor "swap X for Y", "trim Z", "drop section A" over "add another bullet about B" when the resume is already full.

Respond with a JSON object matching the provided schema. Do not include any prose outside the JSON.`;

export async function POST(req: NextRequest) {
  try {
    const { resume, jobDescription } = (await req.json()) as {
      resume?: string;
      jobDescription?: string;
    };

    if (!resume?.trim() || !jobDescription?.trim()) {
      return NextResponse.json(
        { error: "Both resume and jobDescription are required." },
        { status: 400 },
      );
    }

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
          content: `Evaluate this resume against the job description below.

=== JOB DESCRIPTION ===
${jobDescription}

=== RESUME (LaTeX source) ===
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
