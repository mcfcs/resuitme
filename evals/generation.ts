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
import { runFitLoop } from "@/lib/trim-loop";
import { lintLatexForAts } from "@/lib/ats/source-lint";
import { findUngroundedNumbers } from "@/lib/ats/number-check";
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
   * The most this fixture's source material can honestly support, declared in
   * the fixture rather than inferred. Inference is wrong in both directions:
   * résumé prose legitimately expands from compressed source, and for a rich
   * fixture the source happens to exceed the budget only by accident.
   */
  sourceCeiling?: number;
  /** chars / budget. Kept because it is the number the app actually targets. */
  fill?: number;
  /**
   * chars / min(budget, sourceCeiling) — how much of what was ACHIEVABLE was
   * used. A fixture that used everything it had scores 100% here even when its
   * raw fill is 31%, which is the honest reading.
   */
  effectiveFill?: number;
  /** True when the source, not the budget, is the binding constraint. */
  ceilingBound?: boolean;
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
  /** Figures in the output that the candidate's material does not support. */
  inventedNumbers?: string[];
  /** 1 when the expand pass ran, 0 when the draft was already in band. */
  expandPasses?: number;
  /** True when an expansion was produced but rejected as a regression. */
  expandReverted?: boolean;
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

/**
 * Honesty matching is NOT the same problem as must_include matching.
 *
 * A must_include miss is cosmetic, so `mentions` is deliberately loose. An
 * honesty violation is an accusation that the résumé claims a skill the
 * candidate disclaimed, so a false positive is worse than a miss.
 *
 * Single-letter keywords are the failure case: the analyzer emits "R" and "C"
 * as real skills, and a bare token test then fires on any stray capital in the
 * extracted PDF text — a middle initial, a section letter, a mis-transcribed
 * glyph. Measured: "R" was reported against a résumé that never mentions it.
 * Such a keyword needs corroborating context to count.
 */
export function claimsDisclaimed(extracted: string, keyword: string): boolean {
  const n = keyword.trim();
  if (!n) return false;

  // Multi-character keywords are unambiguous enough for the normal test.
  if (n.replace(/[^a-z0-9+#]/gi, "").length > 1) return mentions(extracted, n);

  // A one-letter skill only counts when it appears as a skill would: next to
  // a language/skill cue, not floating alone.
  const hay = extracted.toLowerCase();
  const k = n.toLowerCase().replace(/[^a-z0-9+#]/g, "");
  if (!k) return false;

  // \b is unreliable next to "+"/"#" (c++, c#), so bound on explicit
  // separators instead. The letter must sit inside a skill-ish clause.
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const B = `(?:^|[^a-z0-9+#])${esc}(?:$|[^a-z0-9+#])`;
  const CUE = "languages?|skills?|proficient|programming|stack|tools?";
  const TRAIL = "programming|language|statistical|scripting|developer";
  const cue = new RegExp(
    `(?:${CUE})[^.\\n]{0,80}${B}` + `|${B}[^.\\n]{0,60}(?:${TRAIL})`,
    "i",
  );
  return cue.test(hay);
}

export type BuildDeps = {
  /** Calls /api/build's handler. */
  build: (
    cuts: string[] | undefined,
    budget: number,
    additions?: string[],
  ) => Promise<string>;
  /** Calls /api/tailor/verify's handler. */
  requestCuts: (
    latex: string,
    chars: number,
    overBy: number,
  ) => Promise<string[]>;
  /** Compiles LaTeX and returns the PDF bytes, or null. */
  compile: (latex: string) => Promise<Uint8Array | null>;
  /** Calls /api/tailor/expand's handler. Returns quote-verified instructions. */
  requestAdditions: (
    latex: string,
    chars: number,
    shortBy: number,
  ) => Promise<string[]>;
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
  /** Declared in the fixture. Absent means the budget always binds. */
  sourceCeiling?: number,
  /**
   * The candidate's own material. Figures in the output that this does not
   * support were invented. Absent skips the check rather than reporting
   * everything as fabricated.
   */
  numericPool?: string,
): Promise<GenerationResult> {
  const started = Date.now();
  const template: BuiltinTemplate = getTemplate(templateId);

  try {
    const { budget } = computeBuildBudget(undefined, template.targetChars);

    const result = await runFitLoop(budget, {
      generate: (cuts, additions) => deps.build(cuts, budget, additions),
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
      requestAdditions: deps.requestAdditions,
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
    const violations = disclaimedKeywords.filter((k) =>
      claimsDisclaimed(extracted, k),
    );

    // --- placeholder leakage ----------------------------------------------
    const leaks = template.placeholders.filter((p) => latex.includes(p));

    // --- static lint on what the model produced ---------------------------
    const critical = lintLatexForAts(latex)
      .filter((f) => f.severity === "critical")
      .map((f) => f.title);

    // --- invented figures --------------------------------------------------
    // Distinct from honesty violations, which only catch disclaimed KEYWORDS.
    // A fabricated quantity attached to real work ("...by 15%") passes every
    // other check here.
    const inventedNumbers = numericPool
      ? findUngroundedNumbers(latex, numericPool).map((c) => c.raw)
      : [];

    // Fill against what was ACHIEVABLE, not merely against the budget. A
    // fixture whose source cannot fill a page is not underperforming when it
    // does not.
    const achievable = Math.min(
      budget,
      sourceCeiling ?? Number.POSITIVE_INFINITY,
    );

    return {
      name,
      ok: true,
      ms: Date.now() - started,
      atsScore: scan?.score,
      sourceCeiling,
      fill: visible / budget,
      effectiveFill: visible / achievable,
      ceilingBound: achievable < budget,
      pages: result.pages,
      iterations: result.iterations,
      chars: visible,
      budget,
      mustIncludeCoverage: coverage,
      mustIncludeMissed: missed,
      honestyViolations: violations,
      placeholderLeaks: leaks,
      criticalFindings: critical,
      inventedNumbers,
      expandPasses: result.expandPasses,
      expandReverted: result.expandReverted,
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
    "| Case | ATS | Pages | must_include | Honesty | Figures | Placeholders | Trims | Fill | Time |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const r of results) {
    if (!r.ok) {
      lines.push(`| ${r.name} | — | — | — | — | — | — | — | — | ERROR |`);
      continue;
    }
    const honesty = r.honestyViolations?.length
      ? `**${r.honestyViolations.join(", ")}**`
      : "clean";
    const leaks = r.placeholderLeaks?.length
      ? `**${r.placeholderLeaks.length}**`
      : "none";
    // An invented figure is a separate failure from a disclaimed keyword: the
    // claim is real, the number attached to it is not.
    const figures = r.inventedNumbers?.length
      ? `**${r.inventedNumbers.join(", ")}**`
      : "clean";
    lines.push(
      `| ${r.name} | ${r.atsScore ?? "—"} | ${r.pages ?? "—"} ` +
        `| ${pct(r.mustIncludeCoverage ?? 0)} | ${honesty} | ${figures} | ${leaks} ` +
        `| ${r.iterations} | ${fillCell(r)} | ${secs(r.ms)} |`,
    );
  }

  const ok = results.filter((r) => r.ok);
  if (ok.length) {
    const avg = (pick: (r: GenerationResult) => number) =>
      ok.reduce((s, r) => s + pick(r), 0) / ok.length;
    const onePage = ok.filter((r) => r.pages === 1).length;
    const movable = ok.filter((r) => !r.ceilingBound);
    lines.push(
      `| **mean** | ${Math.round(avg((r) => r.atsScore ?? 0))} ` +
        `| ${onePage}/${ok.length} at 1pp ` +
        `| ${pct(avg((r) => r.mustIncludeCoverage ?? 0))} ` +
        `| ${results.reduce((s, r) => s + (r.honestyViolations?.length ?? 0), 0)} total ` +
        `| ${results.reduce((s, r) => s + (r.inventedNumbers?.length ?? 0), 0)} total ` +
        `| ${results.reduce((s, r) => s + (r.placeholderLeaks?.length ?? 0), 0)} total ` +
        `| ${avg((r) => r.iterations ?? 0).toFixed(1)} ` +
        `| ${movable.length ? pct(movable.reduce((s, r) => s + (r.fill ?? 0), 0) / movable.length) : "—"} (${movable.length} movable) ` +
        `/ ${pct(avg((r) => r.effectiveFill ?? 0))} eff ` +
        `| ${secs(avg((r) => r.ms))} |`,
    );
  }

  if (ok.some((r) => r.ceilingBound)) {
    lines.push("");
    lines.push(
      "† source-ceiling-bound: the fixture's material cannot fill the budget, so raw fill understates it. Fill is shown as raw (effective).",
    );
  }

  // A sparse fixture suddenly filling the page is the signature of fabrication
  // under fill pressure — the exact failure a prompt-level floor produced when
  // it was measured. Flag it loudly rather than letting it read as a win.
  const suspicious = ok.filter(
    (r) => r.ceilingBound && (r.effectiveFill ?? 0) > 1.1,
  );
  for (const r of suspicious) {
    lines.push(
      `⚠ **${r.name}** exceeded its declared source ceiling by ${pct((r.effectiveFill ?? 1) - 1)} — check for invented content.`,
    );
  }

  return lines.join("\n");
}

/** Raw fill, with the effective figure alongside when the source binds. */
function fillCell(r: GenerationResult): string {
  const raw = pct(r.fill ?? 0);
  if (!r.ceilingBound) return raw;
  return `${raw} (${pct(r.effectiveFill ?? 0)})†`;
}
