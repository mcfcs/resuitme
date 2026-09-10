// Builds the LAYOUT CONTRACT block: the per-template structure rules that used
// to be hardcoded, four times over, inside the system prompts.
//
// WHY THIS EXISTS: the canonical section order was restated verbatim in
// lib/prompts/build.ts, lib/prompts/tailor.ts, lib/prompts/verify.ts and the
// templates registry's description string. Adding a layout with a different
// order meant editing all four and hoping they agreed. Now the template owns
// its structure and the prompts defer to this block.
//
// The system prompts stay verbatim constants stating unconditional guarantees
// (honesty, budget discipline, output format). What is template-SPECIFIC moves
// into the user message, where per-request data belongs.

import type { BuiltinTemplate } from "@/lib/templates";

/**
 * Render the contract for a built-in template.
 *
 * IMPORTANT: only call this when the app actually knows the layout — i.e. for
 * a built-in template. When the user supplies their own LaTeX, we do not know
 * its section order or macros, and asserting Classic's would actively corrupt
 * the output. See /api/build's resolution logic.
 */
export function layoutContractBlock(template: BuiltinTemplate): string {
  const lines: string[] = [
    "",
    "=== LAYOUT CONTRACT (this template's structure — obey exactly) ===",
    `Section order: ${template.sectionOrder.join(" → ")}`,
    `Mandatory sections (never omit, even when the budget is tight): ${template.requiredSections.join(", ")}`,
  ];

  if (template.optionalSections.length) {
    lines.push(
      `Optional sections (omit only when the candidate has no content for them): ${template.optionalSections.join(", ")}`,
    );
  }

  lines.push(
    "Do not add, rename, split or reorder sections. Do not invent sections outside the lists above — fold such content into a listed section or omit it.",
    "Reordering for relevance applies ONLY to items and bullets WITHIN a section, never to the section sequence.",
    // Both failures below were produced by the model and broke compilation
    // outright, which surfaces only as a blank score in the eval.
    "ESCAPING: inside macro arguments, write & as \\& and % as \\% (e.g. {Founder \\& Data Analyst}). A bare & or % there is a compile error, not a typo.",
    "BRACES: every macro argument must have balanced braces. Do not emit a stray closing }} after a completed \\small{\\item{...}} group.",
  );

  if (template.macros.length) {
    lines.push("", "Layout macros — use these verbatim, do not redefine them:");
    for (const m of template.macros) {
      const call = m.args.length
        ? `\\${m.name}${m.args.map((a) => `{${a}}`).join("")}`
        : `\\${m.name}`;
      lines.push(`  ${call} — ${m.purpose}`);
    }
  }

  if (template.placeholders.length) {
    lines.push(
      "",
      "The template's inline content is placeholder material demonstrating each macro. Replace ALL of it with the candidate's real content. None of these strings may appear in your output:",
      `  ${template.placeholders.map((p) => `"${p}"`).join(", ")}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * The subset the trim planner needs: which sections it may never propose
 * cutting. Kept separate because /api/tailor/verify has no template when the
 * user brought their own LaTeX, and must then fall back to its own defaults.
 */
export function protectedSectionsBlock(template: BuiltinTemplate): string {
  return `\nSections that must survive every cut: ${template.requiredSections.join(", ")}.\n`;
}
