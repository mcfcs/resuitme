// Generation eval: scores the résumé the app actually produces, not just the
// analyzer's opinion of the input.
//
// Run with: npm run eval -- --suite generation
//
// NOT run in CI — every case is a full build (several sequential model passes)
// plus two LaTeX compiles. Minutes per case on a local model.
//
// Every metric here is objective. There is no judge model, because a judge
// model's opinion of a résumé is exactly the thing we cannot verify.

import { visibleChars } from "@/lib/latex";
import { getTemplate, type BuiltinTemplate } from "@/lib/templates";
import { runTrimLoop } from "@/lib/trim-loop";
import { lintLatexForAts } from "@/lib/ats/source-lint";
import { scanPdfBytes } from "@/lib/ats/pdf-scan";
import { computeBuildBudget } from "@/lib/latex";
import type { Analysis } from "@/lib/types";

export type GenerationResult = {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
  /** ATS score of the compiled output, 0-100. */
  atsScore?: number;
  /** Real page count. Anything but 1 is a failure of the whole pipeline. */
  pages?: number | null;
  /** Trim passes used. A proxy for how well the budget is calibrated. */
  iterations?: number;
  /** Visible chars of the final draft, against the budget it was given. */
  chars?: number;
  budget?: number;
  /**
   * Fraction of the analyzer's must_include picks that survived into the
   * output. THE headline metric — it measures whether wiring must_include
   * through to the generator actually changed anything.
   */
  mustIncludeCoverage?: number;
  mustIncludeMissed?: string[];
  /** Disclaimed keywords that appeared anyway. Any hit is a contract breach. */
  honestyViolations?: string[];
  /** Template placeholder strings that leaked into the output. */
  placeholderLeaks?: string[];
  /** Critical findings from the static lint on the generated source. */
  criticalFindings?: string[];
};

/** Loose containment test, tolerant of the model rewording a pick's phrasing. */
export function mentions(haystack: string, needle: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const hay = ` ${norm(haystack)} `;
  const n = norm(needle);
  if (!n) return false;
  // Word-boundary containment. A bare substring test reports "go" inside
  // "Django", "Google" and "ongoing" — measured, and it made an honest run
  // look like a contract breach.
  if (hay.includes(` ${n} `)) return true;

  // A pick like "aCount: Sneaker Resale Accounting Platform" is satisfied by
  // the distinctive part of the name; requiring the full string would report
  // failures that are purely cosmetic.
  const words = n.split(" ").filter((w) => w.length > 3);
  if (!words.length) return false;
  const hits = words.filter((w) => hay.includes(` ${w} `)).length;
  return hits / words.length >= 0.6;
}

export type BuildDeps = {
  /** Calls /api/build's handler. */
  build: (cuts: string[] | undefined, budget: number) => Promise<string>;
  /** Calls /api/tailor/verify's handler. */
  requestCuts: (
    latex: string,
    chars: number,
    overBy: number,
  ) => Promise<string[]>;
  /** Compiles LaTeX and returns the PDF bytes, or null. */
  compile: (latex: string) => Promise<Uint8Array | null>;
};

/**
 * Build one résumé end to end and score it.
 *
 * The trim loop is driven through the same lib/trim-loop.ts the app uses, so
 * this measures the real pipeline rather than a reimplementation of it.
 */
export async function evaluateGeneration(
  name: string,
  analysis: Analysis,
  disclaimedKeywords: string[],
  deps: BuildDeps,
  templateId?: string,
): Promise<GenerationResult> {
  const started = Date.now();
  const template: BuiltinTemplate = getTemplate(templateId);

  try {
    const { budget } = computeBuildBudget(undefined, template.targetChars);

    const result = await runTrimLoop(budget, {
      generate: (cuts) => deps.build(cuts, budget),
      checkPages: async (latex) => {
        const bytes = await deps.compile(latex);
        if (!bytes) {
          return { measured: false, pages: null, compiled: false };
        }
        const scan = await scanPdfBytes(bytes);
        return {
          measured: scan !== null,
          pages: scan?.pages ?? null,
          compiled: true,
        };
      },
      requestCuts: deps.requestCuts,
    });

    const latex = result.latex;
    const visible = visibleChars(latex);

    // --- ATS on the final draft -------------------------------------------
    const bytes = await deps.compile(latex);
    const scan = bytes ? await scanPdfBytes(bytes) : null;
    const extracted = scan?.text ?? visibleTextFallback(latex);

    // --- must_include coverage --------------------------------------------
    const picks = analysis.must_include ?? [];
    const missed = picks
      .filter((p) => !mentions(extracted, p.item))
      .map((p) => p.item);
    const coverage = picks.length
      ? (picks.length - missed.length) / picks.length
      : 1;

    // --- honesty ----------------------------------------------------------
    const violations = disclaimedKeywords.filter((k) => mentions(extracted, k));

    // --- placeholder leakage ----------------------------------------------
    const leaks = template.placeholders.filter((p) => latex.includes(p));

    // --- static lint on what the model produced ---------------------------
    const critical = lintLatexForAts(latex)
      .filter((f) => f.severity === "critical")
      .map((f) => f.title);

    return {
      name,
      ok: true,
      ms: Date.now() - started,
      atsScore: scan?.score,
      pages: result.pages,
      iterations: result.iterations,
      chars: visible,
      budget,
      mustIncludeCoverage: coverage,
      mustIncludeMissed: missed,
      honestyViolations: violations,
      placeholderLeaks: leaks,
      criticalFindings: critical,
    };
  } catch (e) {
    return {
      name,
      ok: false,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** When the compile is unavailable, fall back to the char-level view. */
function visibleTextFallback(latex: string): string {
  return latex;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function generationReport(
  results: GenerationResult[],
  label: string,
): string {
  const lines: string[] = [];
  lines.push(`### Generation eval: \`${label}\``);
  lines.push("");
  lines.push(
    "| Case | ATS | Pages | must_include | Honesty | Placeholders | Trims | Chars/Budget | Time |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const r of results) {
    if (!r.ok) {
      lines.push(`| ${r.name} | — | — | — | — | — | — | — | ERROR |`);
      continue;
    }
    const honesty = r.honestyViolations?.length
      ? `**${r.honestyViolations.join(", ")}**`
      : "clean";
    const leaks = r.placeholderLeaks?.length
      ? `**${r.placeholderLeaks.length}**`
      : "none";
    lines.push(
      `| ${r.name} | ${r.atsScore ?? "—"} | ${r.pages ?? "—"} ` +
        `| ${pct(r.mustIncludeCoverage ?? 0)} | ${honesty} | ${leaks} ` +
        `| ${r.iterations} | ${r.chars}/${r.budget} | ${secs(r.ms)} |`,
    );
  }

  const ok = results.filter((r) => r.ok);
  if (ok.length) {
    const avg = (pick: (r: GenerationResult) => number) =>
      ok.reduce((s, r) => s + pick(r), 0) / ok.length;
    const onePage = ok.filter((r) => r.pages === 1).length;
    lines.push(
      `| **mean** | ${Math.round(avg((r) => r.atsScore ?? 0))} ` +
        `| ${onePage}/${ok.length} at 1pp ` +
        `| ${pct(avg((r) => r.mustIncludeCoverage ?? 0))} ` +
        `| ${results.reduce((s, r) => s + (r.honestyViolations?.length ?? 0), 0)} total ` +
        `| ${results.reduce((s, r) => s + (r.placeholderLeaks?.length ?? 0), 0)} total ` +
        `| ${avg((r) => r.iterations ?? 0).toFixed(1)} | — | ${secs(avg((r) => r.ms))} |`,
    );
  }
  return lines.join("\n");
}
