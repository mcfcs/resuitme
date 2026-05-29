import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, MODEL } from "@/lib/anthropic";
import type { Analysis } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are an expert resume writer who specializes in tailoring resumes to specific job descriptions while preserving the candidate's truthfulness and voice.

Core rules — never break these:
1. NEVER invent experience, skills, employers, dates, or accomplishments the candidate has not actually demonstrated. You may only rephrase, reframe, reorder, or surface what is already implicit in the existing resume.
2. Preserve the LaTeX preamble, document class, and packages exactly as written. The output must compile with the same toolchain.
3. Preserve the candidate's voice. Don't make every bullet sound corporate.
4. Don't keyword-stuff. If a JD term doesn't honestly apply, leave it out.

What you SHOULD do:
- Rewrite bullets to lead with the outcome that matters most for this role.
- Quantify impact where the original resume provides the numbers.
- Re-order sections or bullets so the most relevant experience appears first.
- Use the JD's terminology when the candidate has genuinely done the equivalent work.
- Trim filler so the resume stays at roughly its original length.

Output format:
- Return ONLY the complete, compilable LaTeX source.
- Begin your response with the opening \\documentclass or %-comment of the resume.
- End with \\end{document}.
- Do NOT wrap the output in code fences. Do NOT include any prose, preamble, or explanation outside the LaTeX.`;

export async function POST(req: NextRequest) {
  try {
    const { resume, jobDescription, analysis } = (await req.json()) as {
      resume?: string;
      jobDescription?: string;
      analysis?: Analysis;
    };

    if (!resume?.trim() || !jobDescription?.trim()) {
      return NextResponse.json(
        { error: "Both resume and jobDescription are required." },
        { status: 400 },
      );
    }

    const client = getAnthropic();

    const analysisContext = analysis
      ? `\n=== PRIOR ANALYSIS (use this to prioritize edits) ===
Score: ${analysis.score}/100
Verdict: ${analysis.verdict}
Top gaps to address: ${analysis.gaps.join("; ")}
Missing keywords to weave in IF the candidate's experience supports them: ${analysis.keyword_coverage.missing.join(", ")}
Suggested edits: ${analysis.suggestions.join("; ")}
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
${analysisContext}
=== ORIGINAL RESUME (LaTeX source) ===
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
    // Defensive: strip stray markdown fences if the model adds them.
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
