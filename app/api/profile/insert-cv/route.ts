import { NextRequest, NextResponse } from "next/server";
import { completeText, llmErrorResponse } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 180;

export type InsertSection =
  | "experience"
  | "project"
  | "education"
  | "award"
  | "publication";

const SYSTEM_PROMPT = `You are a LaTeX editor. Your job is to INSERT one new entry into an existing CV LaTeX source while preserving the rest of the file byte-for-byte.

RULES:
1. Locate the section of the CV that matches the requested section type. Section header variations to recognize:
   - experience: "Experience", "Work Experience", "Professional Experience", "Employment"
   - project: "Projects", "Personal Projects", "Open Source", "Selected Projects"
   - education: "Education", "Academic Background"
   - award: "Awards", "Honors", "Awards & Honors", "Recognitions"
   - publication: "Publications", "Papers", "Selected Publications"
2. Insert the new entry at the END of that section — after the last existing entry, before the next section header / environment / \\end{document}.
3. CRITICAL: match the formatting of existing entries EXACTLY. Inspect the document class and the macros already used.
   - If existing entries use \\cventry, use \\cventry with the same argument pattern.
   - If they use \\experience{}{}{}{} or any custom macro, use that exact macro signature.
   - If they use itemize with \\item bullets, use itemize with \\item.
   - Match indentation, blank lines, and spacing conventions of surrounding entries.
4. If the requested section does NOT exist in the CV, create it in a reasonable position:
   - projects: after experience
   - education: after experience (or after projects if projects exists)
   - awards / publications: near the bottom, before \\end{document}
   Use a section command that matches the style of existing sections in the file (e.g., \\section{} vs \\cvsection{}).
5. Preserve ALL other content byte-for-byte. Do NOT reformat, re-comment, re-indent, or "clean up" anything else.
6. Do NOT add commentary, notes, or TODO comments inside the LaTeX. The output must be production-ready.

OUTPUT: the COMPLETE updated LaTeX source. Begin with the very first character of the original file (e.g., \\documentclass or a leading %-comment). End with \\end{document} (or the original final line). No code fences. No prose outside the LaTeX.`;

export async function POST(req: NextRequest) {
  try {
    const { cvLatex, section, polished } = (await req.json()) as {
      cvLatex?: string;
      section?: InsertSection;
      polished?: Record<string, unknown>;
    };

    if (!cvLatex?.trim()) {
      return NextResponse.json({ error: "Missing cvLatex." }, { status: 400 });
    }
    if (!section) {
      return NextResponse.json({ error: "Missing section." }, { status: 400 });
    }
    if (!polished || typeof polished !== "object") {
      return NextResponse.json(
        { error: "Missing polished entry." },
        { status: 400 },
      );
    }

    const latex = await completeText({
      tier: "fast",
      maxTokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Insert this entry into the "${section}" section of the CV LaTeX below.

=== NEW ENTRY (structured JSON — translate into LaTeX using the same macros/format as existing entries in this section) ===
${JSON.stringify(polished, null, 2)}

=== EXISTING CV LATEX ===
${cvLatex}

Return the complete updated LaTeX source. No code fences. No commentary.`,
        },
      ],
    });

    return NextResponse.json({ updatedCvLatex: latex });
  } catch (err) {
    console.error("[/api/profile/insert-cv]", err);
    const { error, status } = llmErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
