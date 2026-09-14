// Multi-run aggregation for the generation eval.
//
// WHY THIS EXISTS: on identical code the generation suite swings ±25 points
// PER CASE between runs (measured: adjacent-not-equal 96 → 94 → 69,
// fullstack-react-flask 92 → 99 → 72). A single-run fill or must_include
// number is therefore not a measurement, and every conclusion drawn from one
// this project has had to be walked back at least once. `--runs N` repeats
// each case and reports mean ± spread, so a falsely precise number is never
// printed without the uncertainty that belongs next to it.
//
// The only single-run-trustworthy signals are the honesty counts — disclaimed
// keywords, invented figures, placeholder leaks — which were 0 on every run.
// Those are reported as TOTALS across runs, because one hit is one too many
// and averaging it away would hide it.
//
// Pure and dependency-free so it is unit-testable without a model.

import type { GenerationResult } from "./generation";

/**
 * A metric summarised across runs.
 *
 * `spread` is the LARGEST DEVIATION from the mean, so `mean ± spread` brackets
 * every observed value — a reader can recover the worst run from the two
 * numbers printed. A standard deviation over three samples is not a
 * meaningful number; the extremes are honest about how little is known.
 */
export type MetricStat = {
  mean: number;
  spread: number;
  min: number;
  max: number;
  n: number;
  /** True when the range exceeds the metric's reliability threshold. */
  unreliable: boolean;
};

export type AggregatedCase = {
  name: string;
  /** Runs attempted for this case. */
  runs: number;
  /** Runs that produced a scored result. */
  okRuns: number;
  errors: string[];
  atsScore?: MetricStat;
  mustIncludeCoverage?: MetricStat;
  fill?: MetricStat;
  effectiveFill?: MetricStat;
  iterations?: MetricStat;
  /** Runs (of `okRuns`) that landed on one page. */
  onePage: number;
  ceilingBound: boolean;
  /** Runs whose effective fill exceeded the ceiling tripwire. */
  ceilingBreaches: number;
  // Totals across runs — never averaged, one hit is a real finding.
  honestyViolations: number;
  inventedNumbers: number;
  placeholderLeaks: number;
  criticalFindings: number;
  expandPasses: number;
};

/**
 * A range wider than this on a 0–1 metric is reported as unreliable. Ten
 * points is well inside the measured run-to-run swing, so a metric that stays
 * within it across runs is one that has actually settled.
 */
export const UNRELIABLE_RANGE = 0.1;

/** Same threshold for the 0–100 ATS score. */
const UNRELIABLE_RANGE_ATS = 10;

/** Effective fill above this on a ceiling-bound case is the fabrication tripwire. */
export const CEILING_TRIPWIRE = 1.1;

export function stat(
  values: number[],
  unreliableRange = UNRELIABLE_RANGE,
): MetricStat | undefined {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return undefined;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  return {
    mean,
    spread: Math.max(max - mean, mean - min),
    min,
    max,
    n: xs.length,
    unreliable: max - min > unreliableRange,
  };
}

/**
 * Collapse N runs of the suite into one row per case.
 *
 * Cases are keyed by name, so a case that errored in one run and scored in
 * another is still one row: the error is listed and the stats cover the runs
 * that produced a number. The run count is stated per row precisely so a
 * reader can see when a mean rests on fewer runs than were attempted.
 */
export function aggregateRuns(runs: GenerationResult[][]): AggregatedCase[] {
  const byName = new Map<string, GenerationResult[]>();
  for (const run of runs) {
    for (const r of run) {
      const list = byName.get(r.name) ?? [];
      list.push(r);
      byName.set(r.name, list);
    }
  }

  const out: AggregatedCase[] = [];
  for (const [name, all] of byName) {
    const ok = all.filter((r) => r.ok);
    const num = (pick: (r: GenerationResult) => number | undefined) =>
      ok.map(pick).filter((v): v is number => typeof v === "number");
    const total = (pick: (r: GenerationResult) => number | undefined) =>
      all.reduce((s, r) => s + (pick(r) ?? 0), 0);
    const ceilingBound = ok.some((r) => r.ceilingBound);

    out.push({
      name,
      runs: all.length,
      okRuns: ok.length,
      errors: all.filter((r) => !r.ok).map((r) => r.error ?? "unknown error"),
      atsScore: stat(
        num((r) => r.atsScore),
        UNRELIABLE_RANGE_ATS,
      ),
      mustIncludeCoverage: stat(num((r) => r.mustIncludeCoverage)),
      fill: stat(num((r) => r.fill)),
      effectiveFill: stat(num((r) => r.effectiveFill)),
      // Trim passes are a calibration proxy, not a score; never flagged.
      iterations: stat(
        num((r) => r.iterations),
        Number.POSITIVE_INFINITY,
      ),
      onePage: ok.filter((r) => r.pages === 1).length,
      ceilingBound,
      ceilingBreaches: ok.filter(
        (r) => r.ceilingBound && (r.effectiveFill ?? 0) > CEILING_TRIPWIRE,
      ).length,
      honestyViolations: total((r) => r.honestyViolations?.length),
      inventedNumbers: total((r) => r.inventedNumbers?.length),
      placeholderLeaks: total((r) => r.placeholderLeaks?.length),
      criticalFindings: total((r) => r.criticalFindings?.length),
      expandPasses: total((r) => r.expandPasses),
    });
  }
  return out;
}

// ---------------------------------------------------------------- report ----

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** "85% ±4" — with a warning glyph when the range says not to trust it. */
function pctCell(s: MetricStat | undefined): string {
  if (!s) return "—";
  const core = `${pct(s.mean)} ±${Math.round(s.spread * 100)}`;
  return s.unreliable ? `${core}⚠` : core;
}

function scoreCell(s: MetricStat | undefined): string {
  if (!s) return "—";
  const core = `${Math.round(s.mean)} ±${Math.round(s.spread)}`;
  return s.unreliable ? `${core}⚠` : core;
}

/** Zero prints plainly; anything else is bold so it cannot be skimmed past. */
function countCell(n: number): string {
  return n === 0 ? "0" : `**${n}**`;
}

/**
 * Per-run suite means for a metric, so the mean row's ± reflects how much the
 * SUITE moves between runs rather than pooling every case into one bag.
 */
function suiteMeans(
  runs: GenerationResult[][],
  pick: (r: GenerationResult) => number | undefined,
  include: (r: GenerationResult) => boolean = () => true,
): number[] {
  const means: number[] = [];
  for (const run of runs) {
    const vals = run
      .filter((r) => r.ok && include(r))
      .map(pick)
      .filter((v): v is number => typeof v === "number");
    if (vals.length) means.push(vals.reduce((s, v) => s + v, 0) / vals.length);
  }
  return means;
}

export function aggregatedReport(
  runs: GenerationResult[][],
  label: string,
): string {
  const cases = aggregateRuns(runs);
  const n = runs.length;
  const lines: string[] = [];
  lines.push(`### Generation eval: \`${label}\` — ${n} runs per case`);
  lines.push("");
  lines.push(
    "| Case | ATS | 1-page | must_include | Honesty | Figures | Placeholders | Trims | Fill |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const c of cases) {
    const runsNote = c.okRuns < c.runs ? ` (${c.okRuns}/${c.runs} ok)` : "";
    const fill = c.ceilingBound
      ? `${pctCell(c.fill)} (${pctCell(c.effectiveFill)})†`
      : pctCell(c.fill);
    lines.push(
      `| ${c.name}${runsNote} | ${scoreCell(c.atsScore)} | ${c.onePage}/${c.okRuns} ` +
        `| ${pctCell(c.mustIncludeCoverage)} | ${countCell(c.honestyViolations)} ` +
        `| ${countCell(c.inventedNumbers)} | ${countCell(c.placeholderLeaks)} ` +
        `| ${c.iterations ? c.iterations.mean.toFixed(1) : "—"} | ${fill} |`,
    );
  }

  const okAll = runs.flat().filter((r) => r.ok);
  if (okAll.length) {
    const onePage = okAll.filter((r) => r.pages === 1).length;
    const movable = (r: GenerationResult) => !r.ceilingBound;
    const movableCount = new Set(okAll.filter(movable).map((r) => r.name)).size;
    const sum = (pick: (c: AggregatedCase) => number) =>
      cases.reduce((s, c) => s + pick(c), 0);
    lines.push(
      `| **mean** | ${scoreCell(
        stat(
          suiteMeans(runs, (r) => r.atsScore),
          UNRELIABLE_RANGE_ATS,
        ),
      )} ` +
        `| ${onePage}/${okAll.length} ` +
        `| ${pctCell(stat(suiteMeans(runs, (r) => r.mustIncludeCoverage)))} ` +
        `| ${sum((c) => c.honestyViolations)} total ` +
        `| ${sum((c) => c.inventedNumbers)} total ` +
        `| ${sum((c) => c.placeholderLeaks)} total ` +
        `| ${stat(suiteMeans(runs, (r) => r.iterations))?.mean.toFixed(1) ?? "—"} ` +
        `| ${movableCount ? pctCell(stat(suiteMeans(runs, (r) => r.fill, movable))) : "—"} (${movableCount} movable) ` +
        `/ ${pctCell(stat(suiteMeans(runs, (r) => r.effectiveFill)))} eff |`,
    );
  }

  lines.push("");
  lines.push(
    `± is the largest deviation from the mean across ${n} runs, so mean ± spread brackets every observed value. ` +
      `⚠ marks a range above ${Math.round(UNRELIABLE_RANGE * 100)} points: that number has not settled and must not be concluded from.`,
  );

  if (cases.some((c) => c.ceilingBound)) {
    lines.push(
      "† source-ceiling-bound: the fixture's material cannot fill the budget. Fill is shown as raw (effective).",
    );
  }

  for (const c of cases.filter((c) => c.ceilingBreaches > 0)) {
    lines.push(
      `⚠ **${c.name}** exceeded its declared source ceiling in ${c.ceilingBreaches} of ${c.okRuns} runs — check for invented content.`,
    );
  }

  for (const c of cases.filter((c) => c.errors.length)) {
    lines.push(
      `✗ **${c.name}** errored in ${c.errors.length} run(s): ${c.errors[0]}`,
    );
  }

  return lines.join("\n");
}
