/**
 * Model eval harness for /api/analyze.
 *
 * Turns "is model X better than model Y" from a README anecdote into a
 * command. Each fixture pairs a résumé (or profile) with a job description and
 * the keyword buckets a competent recruiter would produce. We score the
 * model's keyword_coverage against those buckets and report per-bucket
 * precision/recall plus wall-clock.
 *
 * WHY BUCKETS MATTER MORE THAN THE SCORE: the app converts analyzer-flagged
 * `missing` keywords into hard "never mention this" constraints downstream. A
 * false negative in `missing` therefore suppresses real experience from the
 * user's tailored résumé. Recall on `present` is the metric to watch.
 *
 * NOT run in CI — it needs a live model host and takes minutes. See README.
 *
 *   npm run eval
 *   npm run eval -- --model qwen3-coder:30b
 *   npm run eval -- --case cicd-implicit --json out.json
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURE_DIR = join(HERE, "fixtures");

// ------------------------------------------------------------ fixtures ----

type Buckets = { present: string[]; partial: string[]; missing: string[] };

type Fixture = {
  name: string;
  notes?: string;
  jd: string;
  /** Inline LaTeX/profile text. Mutually exclusive with resumeFile. */
  resume?: string;
  /** Path relative to the repo root, e.g. "sampleresume.tex". */
  resumeFile?: string;
  inputKind?: "resume" | "profile";
  expected: Buckets;
  /** Terms the model must not CLAIM the candidate has. See findViolations. */
  mustNotAppear: string[];
  /**
   * Exact phrases that must not appear in the model's prose. Unlike
   * mustNotAppear this is a literal phrase test, used for wording rules the
   * prompt states outright — e.g. a profile input must never be called
   * "the résumé".
   */
  prosePhrasesForbidden?: string[];
};

function loadFixtures(only?: string): Fixture[] {
  const files = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const fixtures = files.map((f) => {
    const raw = JSON.parse(
      readFileSync(join(FIXTURE_DIR, f), "utf8"),
    ) as Fixture;
    if (!raw.resume && !raw.resumeFile) {
      throw new Error(`Fixture ${f}: needs either "resume" or "resumeFile".`);
    }
    if (raw.resumeFile) {
      raw.resume = readFileSync(join(ROOT, raw.resumeFile), "utf8");
    }
    return raw;
  });

  if (!only) return fixtures;
  const picked = fixtures.filter((f) => f.name === only);
  if (!picked.length) {
    throw new Error(
      `No fixture named "${only}". Available: ${fixtures.map((f) => f.name).join(", ")}`,
    );
  }
  return picked;
}

// -------------------------------------------------------------- scoring ----

/**
 * Keyword comparison is deliberately lenient about surface form: models write
 * "CI/CD pipelines" where the fixture says "ci/cd", or "Apache Spark" for
 * "spark". We normalise punctuation/whitespace and count a match when either
 * string contains the other. Strict equality would report failures that are
 * purely cosmetic and drown the real signal.
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[._/\\-]+/g, " ")
    .replace(/[^a-z0-9+#\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function hasAny(list: string[], term: string): boolean {
  return list.some((item) => matches(item, term));
}

type BucketScore = {
  precision: number;
  recall: number;
  f1: number;
  matched: string[];
  missed: string[];
  extra: string[];
};

function scoreBucket(expected: string[], actual: string[]): BucketScore {
  const matched = expected.filter((e) => hasAny(actual, e));
  const missed = expected.filter((e) => !hasAny(actual, e));
  const extra = actual.filter((a) => !hasAny(expected, a));

  // Recall: of the keywords we expected in this bucket, how many did the model
  // put here? Precision: of what the model put here, how many did we expect?
  // `extra` is not automatically wrong — a model may surface JD keywords the
  // fixture did not enumerate — so precision is the softer of the two numbers.
  const recall = expected.length ? matched.length / expected.length : 1;
  const precision = actual.length ? matched.length / actual.length : 1;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1, matched, missed, extra };
}

// ------------------------------------------------------------- analysis ----

type Analysis = {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  must_include: Array<{ item: string; reason: string }>;
  keyword_coverage: Buckets;
};

/**
 * A violation is the model ASSERTING the candidate has something they don't —
 * not merely naming the term.
 *
 * Only the fields that make a positive claim about the candidate are scanned:
 * `strengths`, `must_include`, `verdict`, and the `present`/`partial` keyword
 * buckets. Deliberately excluded:
 *   - `gaps` and `keyword_coverage.missing` — naming an absent skill there is
 *     exactly the correct behaviour, and is what the honesty step consumes.
 *   - `suggestions` — the prompt permits advice like "if you have any exposure
 *     to Kubernetes, add it", which names the term without claiming it.
 *
 * Scanning gaps/suggestions produced false alarms on runs where the model was
 * in fact perfectly honest, which would have made the harness useless as a
 * regression signal.
 */
/**
 * Only the two keyword buckets that constitute a positive claim, plus the
 * must_include ITEM (which must name something real from the candidate's own
 * input). These are structured fields: a term appearing there is unambiguously
 * an assertion that the candidate has it.
 *
 * Free prose (verdict, strengths, gaps, suggestions, must_include.reason) is
 * deliberately NOT scanned. A substring test cannot distinguish "lacks Hugging
 * Face experience" from "used Hugging Face", and the honest negative phrasing
 * is both common and correct — scanning prose flagged perfectly honest runs as
 * violations, which would make the harness useless as a regression signal.
 */
function claimFields(a: Analysis): string[] {
  return [
    ...(a.keyword_coverage?.present ?? []),
    ...(a.keyword_coverage?.partial ?? []),
    ...(a.must_include ?? []).map((m) => m.item),
  ];
}

function findViolations(a: Analysis, mustNotAppear: string[]): string[] {
  const fields = claimFields(a).map(norm).filter(Boolean);
  return mustNotAppear.filter((term) => {
    const t = norm(term);
    return t ? fields.some((f) => f.includes(t)) : false;
  });
}

/** Literal phrase test over the model's prose, for explicit wording rules. */
function findProseViolations(a: Analysis, phrases: string[]): string[] {
  const prose = [
    a.verdict ?? "",
    ...(a.strengths ?? []),
    ...(a.gaps ?? []),
    ...(a.suggestions ?? []),
  ]
    .join(" \n ")
    .toLowerCase();
  return phrases.filter((p) => prose.includes(p.toLowerCase()));
}

// ---------------------------------------------------------------- runner ----

type CaseResult = {
  name: string;
  ok: boolean;
  ms: number;
  score?: number;
  buckets?: Record<keyof Buckets, BucketScore>;
  violations?: string[];
  error?: string;
};

/**
 * Call the analyze route. We import the handler directly rather than starting
 * a dev server: it keeps the harness a single process, and it exercises the
 * exact code path the app uses, prompt included.
 */
async function analyze(fx: Fixture): Promise<Analysis> {
  const { POST } = await import("../app/api/analyze/route");
  const req = new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      resume: fx.resume,
      jobDescription: fx.jd,
      inputKind: fx.inputKind ?? "resume",
    }),
  });

  // The route's parameter is typed NextRequest; at runtime it only uses the
  // standard Request surface (.json()), so a plain Request is sufficient.
  const res = await POST(req as unknown as Parameters<typeof POST>[0]);
  const body = (await res.json()) as { analysis?: Analysis; error?: string };
  if (!res.ok || !body.analysis) {
    throw new Error(body.error ?? `analyze returned HTTP ${res.status}`);
  }
  return body.analysis;
}

async function runCase(fx: Fixture): Promise<CaseResult> {
  const started = Date.now();
  try {
    const analysis = await analyze(fx);
    const cov = analysis.keyword_coverage ?? {
      present: [],
      partial: [],
      missing: [],
    };
    return {
      name: fx.name,
      ok: true,
      ms: Date.now() - started,
      score: analysis.score,
      buckets: {
        present: scoreBucket(fx.expected.present, cov.present ?? []),
        partial: scoreBucket(fx.expected.partial, cov.partial ?? []),
        missing: scoreBucket(fx.expected.missing, cov.missing ?? []),
      },
      violations: [
        ...findViolations(analysis, fx.mustNotAppear),
        ...findProseViolations(analysis, fx.prosePhrasesForbidden ?? []),
      ],
    };
  } catch (e) {
    return {
      name: fx.name,
      ok: false,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// --------------------------------------------------------------- reports ----

const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function markdownReport(results: CaseResult[], model: string): string {
  const lines: string[] = [];
  lines.push(`### Eval: \`${model}\``);
  lines.push("");
  lines.push(
    "| Case | Score | present P/R | partial P/R | missing P/R | Violations | Time |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");

  for (const r of results) {
    if (!r.ok) {
      lines.push(
        `| ${r.name} | — | — | — | — | ERROR | ${secs(r.ms)} |`,
      );
      continue;
    }
    const b = r.buckets!;
    const v = r.violations!.length
      ? `**${r.violations!.join(", ")}**`
      : "none";
    lines.push(
      `| ${r.name} | ${r.score} | ${pct(b.present.precision)} / ${pct(b.present.recall)} ` +
        `| ${pct(b.partial.precision)} / ${pct(b.partial.recall)} ` +
        `| ${pct(b.missing.precision)} / ${pct(b.missing.recall)} ` +
        `| ${v} | ${secs(r.ms)} |`,
    );
  }

  const ok = results.filter((r) => r.ok);
  if (ok.length) {
    const avg = (pick: (r: CaseResult) => number) =>
      ok.reduce((s, r) => s + pick(r), 0) / ok.length;
    lines.push(
      `| **mean** | ${Math.round(avg((r) => r.score ?? 0))} ` +
        `| ${pct(avg((r) => r.buckets!.present.precision))} / ${pct(avg((r) => r.buckets!.present.recall))} ` +
        `| ${pct(avg((r) => r.buckets!.partial.precision))} / ${pct(avg((r) => r.buckets!.partial.recall))} ` +
        `| ${pct(avg((r) => r.buckets!.missing.precision))} / ${pct(avg((r) => r.buckets!.missing.recall))} ` +
        `| ${results.reduce((s, r) => s + (r.violations?.length ?? 0), 0)} total ` +
        `| ${secs(avg((r) => r.ms))} |`,
    );
  }
  return lines.join("\n");
}

/** Per-case detail, printed to stderr so stdout stays a pasteable table. */
function printDetail(results: CaseResult[]): void {
  for (const r of results) {
    if (!r.ok) {
      console.error(`\n[${r.name}] FAILED: ${r.error}`);
      continue;
    }
    const flagged: string[] = [];
    for (const [bucket, s] of Object.entries(r.buckets!)) {
      if (s.missed.length) {
        flagged.push(`  ${bucket}: model omitted ${s.missed.join(", ")}`);
      }
    }
    if (r.violations!.length) {
      flagged.push(
        `  VIOLATION - surfaced terms the candidate lacks: ${r.violations!.join(", ")}`,
      );
    }
    if (flagged.length) {
      console.error(`\n[${r.name}]`);
      console.error(flagged.join("\n"));
    }
  }
}

// ------------------------------------------------------------------ main ----

function parseArgs(argv: string[]) {
  const out: {
    model?: string;
    only?: string;
    json?: string;
    think?: string;
  } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") out.model = argv[++i];
    else if (a === "--case") out.only = argv[++i];
    else if (a === "--json") out.json = argv[++i];
    else if (a === "--think") out.think = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: npm run eval -- [options]",
          "",
          "  --model <id>   Override OLLAMA_MODEL / ANTHROPIC_MODEL for this run",
          "  --think <v>    Override OLLAMA_THINK: low | medium | high | off",
          "                 Use 'off' for a model that does not support thinking",
          "                 at all (Ollama rejects the request with HTTP 400).",
          "                 'off' UNSETS the variable rather than sending",
          "                 think:false, which crashes gpt-oss's llama-server.",
          "  --case <name>  Run a single fixture by name",
          "  --json <path>  Also write raw results as JSON",
          "",
          "Needs a live model host; not run in CI.",
          "",
          "Compare two models:",
          "  npm run eval -- --model gpt-oss:20b --json a.json",
          "  npm run eval -- --model qwen3:32b   --json b.json",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Load .env.local the way Next does, so the harness talks to the same
  // backend the app would. Set BEFORE importing the route, which reads
  // process.env through lib/llm.ts.
  try {
    const { loadEnvConfig } = await import("@next/env");
    loadEnvConfig(ROOT);
  } catch {
    // @next/env ships with Next; if it is unavailable, fall back to whatever
    // is already in the environment.
  }

  // --model overrides whichever provider is configured, so two models can be
  // compared without editing .env.local.
  if (args.model) {
    const provider = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
    if (provider === "anthropic") process.env.ANTHROPIC_MODEL = args.model;
    else process.env.OLLAMA_MODEL = args.model;
  }

  // Comparing models usually means comparing across model FAMILIES, and a
  // non-reasoning model rejects the `think` field outright with HTTP 400. So
  // --think off DELETES the variable (lib/llm.ts then omits the field) rather
  // than setting "false", which is the value that crashes gpt-oss.
  if (args.think) {
    if (args.think.toLowerCase() === "off") delete process.env.OLLAMA_THINK;
    else process.env.OLLAMA_THINK = args.think;
  }

  const { backendLabel } = await import("../lib/llm");
  const label = backendLabel();

  const fixtures = loadFixtures(args.only);
  console.error(`Backend: ${label}`);
  console.error(`Fixtures: ${fixtures.length}\n`);

  const results: CaseResult[] = [];
  for (const fx of fixtures) {
    process.stderr.write(`  running ${fx.name} ... `);
    const r = await runCase(fx);
    process.stderr.write(`${r.ok ? secs(r.ms) : "FAILED"}\n`);
    results.push(r);
  }

  printDetail(results);
  console.error("");
  console.log(markdownReport(results, label));

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(results, null, 2));
    console.error(`\nRaw results written to ${args.json}`);
  }

  // Non-zero exit on a hard failure (a case that errored, or a honesty
  // violation) so this can gate a manual release check if desired.
  const hardFail = results.some((r) => !r.ok || (r.violations?.length ?? 0) > 0);
  process.exitCode = hardFail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
