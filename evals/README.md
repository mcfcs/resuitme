# Eval harness

Turns "is model X better than model Y for this app" from an anecdote into a
command.

```bash
npm run eval                                  # currently configured backend
npm run eval -- --model qwen3:32b             # override the model for one run
npm run eval -- --case cicd-implicit          # one fixture
npm run eval -- --json results.json           # also dump raw results
npm run eval -- --help
```

**This is never run in CI.** It needs a live model host (an Ollama server or an
Anthropic key) and takes roughly 8-15 seconds per case on a local 20B model, so
a full pass is minutes of GPU time. CI runs `vitest` only.

## What it measures

Each fixture pairs a résumé (or profile) with a job description and the keyword
buckets a competent recruiter would produce. The harness calls the real
`/api/analyze` route handler — same prompt, same schema, same provider layer —
and scores the model's `keyword_coverage` against those buckets.

**Recall on `present` is the metric that matters most.** The app converts
analyzer-flagged `missing` keywords into hard "never mention this" constraints
downstream, so a keyword the model wrongly files under `missing` actively
suppresses real experience from the user's tailored résumé. `cicd-implicit`
exists specifically to catch that: its résumé describes a GitHub Actions
build/test/deploy pipeline without ever using the string "CI/CD".

`partial` is a soft, judgment-dependent bucket — models legitimately split
adjacent evidence between `present` and `partial`. Treat large swings there as
noise unless `present` recall moves with it.

## Violations

Two independent checks:

- `mustNotAppear` — terms the model must not **claim** the candidate has.
  Checked only against structured claim fields (`keyword_coverage.present`,
  `keyword_coverage.partial`, and `must_include[].item`). Free prose is
  deliberately excluded: a substring test cannot tell "lacks Kubernetes" from
  "used Kubernetes", and naming an absent skill in `gaps` is correct behaviour.
- `prosePhrasesForbidden` — literal phrases banned from the model's prose, for
  wording rules the prompt states outright (e.g. a profile input must never be
  called "the résumé").

Any violation, or any case that errors, makes the run exit non-zero.

## Comparing two models

```bash
npm run eval -- --model gpt-oss:20b --json gptoss.json
npm run eval -- --model qwen3:32b  --json qwen.json
```

Paste the two markdown tables (stdout) side by side into the README. Detail
about which specific keywords each model missed goes to stderr, so
`npm run eval > table.md` keeps the table clean.

Note `--think`: `OLLAMA_THINK` is set for gpt-oss, but a non-reasoning model
rejects the `think` field with HTTP 400. Use `--think off` when comparing
against such a model. That **unsets** the variable; it never sends
`think: false`, which crashes gpt-oss's llama-server (see the README warning).

Model output is not deterministic even at low temperature — expect a few points
of movement between runs on the same model. Look for consistent, large gaps.

## Adding a fixture

Drop a JSON file in `fixtures/`:

```jsonc
{
  "name": "unique-name",
  "notes": "Why this case exists and what failure it catches.",
  "jd": "job description text",
  "resume": "\\documentclass...", // or "resumeFile": "sampleresume.tex"
  "inputKind": "resume", // or "profile"; defaults to resume
  // Optional. Only when the source is too thin to fill a page honestly —
  // see "Setting sourceCeiling" below.
  "sourceCeiling": { "visibleChars": 1200, "note": "why this number" },
  "expected": { "present": [], "partial": [], "missing": [] },
  "mustNotAppear": [],
  "prosePhrasesForbidden": [], // optional
}
```

Keyword matching is lenient about surface form: punctuation and case are
normalised and a match counts when either string contains the other, so
`"ci/cd"` matches the model's `"CI/CD pipelines"`.

## Generation suite

```bash
npm run eval -- --suite generation
npm run eval -- --suite generation --runs 3          # mean ± spread per case
npm run eval -- --suite generation --template compact
npm run eval -- --suite generation --case cicd-implicit --json out.json
```

Scores the résumé the app actually **produces**, not just the analyzer's
opinion of the input. For each fixture it runs the real `/api/build` handler
through `lib/trim-loop.ts` — the same loop the app uses — then compiles and
scans the result.

Every metric is objective; there is no judge model, because a judge model's
opinion of a résumé is exactly the thing that cannot be verified.

| Metric                  | Why it matters                                                                    |
| ----------------------- | --------------------------------------------------------------------------------- |
| ATS score               | From the PDF text layer. Catches unextractable output.                            |
| Pages                   | Anything but 1 is a whole-pipeline failure.                                       |
| `must_include` coverage | Did the analyzer's ranked picks survive into the output?                          |
| Honesty violations      | Did a disclaimed keyword appear anyway? Any hit is a contract breach.             |
| Figures                 | Quantities in the output that the candidate's material does not support.          |
| Claims                  | Leadership, scale, seniority or duration claims the material does not support.    |
| Placeholder leaks       | The prompt promises zero; nothing else checks.                                    |
| Trims                   | Proxy for how well `targetChars` is calibrated for the layout.                    |
| Fill / effective fill   | How full the page is, against the budget and against what the source could reach. |

`must_include` coverage is the headline. The analyzer produces 3–5 specific
ranked picks, and those are now interpolated into the generation prompt — this
number is what turns "we think that helped" into evidence.

`--template <id>` runs the suite against a specific layout, which is how the
`targetChars` calibration for a new layout gets validated.

### `--runs N`, and why one run is not a measurement

On identical code the suite swings **±25 points per case** between runs:

| case                  | run 2 | run 3 | run 4 |
| --------------------- | ----- | ----- | ----- |
| adjacent-not-equal    | 96%   | 94%   | 69%   |
| fullstack-react-flask | 92%   | 99%   | 72%   |

Every conclusion drawn from a single run of fill or `must_include` has had to
be walked back at least once. So a single run now prints its heading as
`1 run` and `--runs N` repeats the whole pipeline — analyzer included, so its
variance is counted too — and reports each metric as **mean ± spread**:

```
| adjacent-not-equal | 100 ±0 | 3/3 | 100% ±0 | 0 | 0 | 0 | 1.0 | 86% ±17⚠ |
```

- `±` is the largest deviation from the mean, so `mean ± spread` brackets
  every observed run. Three samples do not support a standard deviation; the
  extremes are honest about how little is known.
- `⚠` marks a range wider than 10 points. That number has **not settled** and
  must not be concluded from, however precise it looks.
- Honesty violations, invented figures and placeholder leaks are **totals**
  across runs, never averaged. One hit in three runs is one hit.
- The mean row's `±` is taken over per-run suite means, so it says how much
  the suite as a whole moves between runs.

With `--json`, a multi-run result is written as
`{ runs, results: [[...run 1], [...run 2]], aggregate }`; a single run keeps
the flat array. Cost is linear: three runs of ten fixtures is ~30 minutes on
the local host. The aggregation itself is pure (`evals/aggregate.ts`) and
unit-tested without a model.

### Fill, and why the mean has two numbers

A résumé can only be as long as the candidate's material allows. Measuring
`chars / budget` alone therefore punishes a fixture for being honest: a sparse
profile that fills 31% of the page may already be saying everything true it can
say. Three of the ten fixtures are in exactly that position.

So the report prints two numbers, and **collapsing them back to one trades a
misleading metric for a different misleading metric**:

- **fill** — `chars / budget`. Kept for continuity with older runs.
- **effective fill** — `chars / min(budget, sourceCeiling)`. How much of what
  was _achievable_ got used.

The mean is reported as `85% (7 movable) / 86% eff (10)`: raw fill averaged over
the cases that can actually move, and effective fill over all of them. Rows
bound by their source ceiling are marked `†` and excluded from the movable mean.

**The tripwire:** effective fill above 1.10 on a ceiling-bound case is flagged.
A sparse fixture that suddenly fills the page has almost certainly invented
something — see the experiment below.

### Setting `sourceCeiling` for a new fixture

```jsonc
"sourceCeiling": {
  "visibleChars": 1200,
  "note": "Source measures 569 visible chars: one education line, two projects. Expanding those into full bullets honestly reaches ~1,100. Anything near the 3,420 budget would be invention."
}
```

**Declare it; do not infer it from the source length.** Inference is wrong in
both directions. Résumé prose legitimately expands from compressed CV source —
`sparse-resume-nlp` honestly reaches 31% against a 17% inferred ceiling — and
for a rich source the inferred value silently lands on the budget by accident,
which quietly disables the whole check.

Set it to the length a careful human could reach _without inventing anything_,
and write the reasoning in `note`. Omit the field when the source is rich enough
that the budget binds first; absent means "the budget is the only limit".

### Invented figures

Honesty violations catch a disclaimed **keyword**. They do not catch a
fabricated **quantity** attached to real work, which is a separate failure and
was found only because the ceiling tripwire pointed at the fixture:

> Profile: "Developed demand-based dynamic pricing strategies to maximize
> margins and inventory turnover."
> Output: "boosting inventory turnover by **15%**" and "reducing manual audit
> time by **30%**".

Neither number exists in the source. Every other check passed the résumé.

`lib/ats/number-check.ts` extracts the figures from a generated résumé's body
and verifies each against the candidate's material, skipping what is not a
claim — dates, layout lengths, version numbers like `OAuth 2.0` — and treating
equivalent forms as the same figure (`0.9514` grounds `95.14%`, `700,000+`
grounds `700000`). `/api/build` then regenerates **once**, naming the invented
figures and instructing the model to restate those achievements without a
quantity, and keeps whichever draft invents less. The eval reports what is left
in the **Figures** column.

The check is deliberately conservative: telling someone their real achievement
is fabricated is worse than missing one invention, so anything ambiguous counts
as grounded. Two rules earn their complexity, both from live-pipeline runs:

- **Dropping precision is not invention.** The model wrote `0.951` where the
  profile says `0.9514`. A less precise restatement of a real figure is honest,
  so truncations and roundings are grounded. The reverse is not: a profile
  saying `0.95` does **not** ground a claimed `0.9514`, because added precision
  is fabrication.
- **A figure must be bounded, not merely a substring.** A pool containing
  `UGNAYAN 2030` must not ground an invented `30%`, and `150K` must not ground
  `50`. Grounding compares whole figures with digit-run boundaries.

Turning the check on immediately caught more than percentages: on one run the
model **invented a phone number** for a candidate whose profile has none.

### Unsupported claims

The numeric check catches an invented **quantity**. It cannot catch an
invented **quality**: _"led a team"_, _"at scale"_, _"cross-functional"_,
_"5+ years of experience"_ pass every other gate because the surrounding words
really are the candidate's — only the leadership, scope, seniority or duration
is made up. Measured on the fixture with the sparsest source, the expand
planner proposed _"Oversaw payment collection"_ for a profile that says
_"Managed"_, and the quote check caught it only because the quote was
fabricated too.

`lib/ats/claim-check.ts` is the sibling of the numeric check: four kinds of
claim, each an explicit list, each grounded through an explicit synonym map
(_"Team Leader"_ in the source grounds _"led"_ in the output; _"management"_
grounds _"managed"_). Duration and team-size claims need the figure and the
noun **together** in the source, because a bare "5" anywhere already satisfies
the numeric check and must not satisfy "5+ years". Conservative in the same
direction as its sibling: anything ambiguous is grounded, `sampleresume.tex`
produces zero findings against itself, and so does every built-in template.

`/api/build` runs both checks on the first draft, retries **once** naming every
offender, keeps whichever draft invents less of both, and then — because a
prompt can only ask — strips in code whatever survived: a leading
_"Led a team to design X"_ re-heads to _"Designed X"_, a scope word is deleted,
an invented phone number goes with its separator, a _"by 15%"_ goes with its
preposition. A bullet no rule can rescue is dropped whole. Everything removed
is reported back as `softened`, which the metrics panel offers to the user to
confirm in their own words; a confirmed claim is saved to the profile and
grounds itself from then on.

The eval reports what is left in the **Claims** column as `kind:trigger`
(`leadership:led`, `duration:5 years`). Like figures and honesty violations it
is a total across runs, never a mean.

### Negative result: prompt-level fill pressure fabricates

Recorded so nobody runs this experiment twice.

The obvious fix for low fill is to tell the model to fill the page — correct the
budget block, state an explicit floor, give it a target band. That was
implemented and measured across all ten fixtures:

| Metric             | Before | After    |
| ------------------ | ------ | -------- |
| Movable-case fill  | 74%    | **84%**  |
| One-page rate      | 10/10  | **9/10** |
| ATS mean           | 100    | **90**   |
| Honesty violations | 0      | **3**    |

Fill went up, and everything that matters went down. `sparse-resume-nlp` — the
fixture with the smallest source — fabricated _"tokenization for morphologically
rich languages"_, a JD requirement the candidate does not have, in order to
satisfy the floor. Two other cases blew past their ceilings entirely.

This is token elasticity: tightening a length constraint on a model that can
always satisfy it by inventing converts a fill problem into a fabrication
problem. **The change was reverted.**

The lesson generalises, and it is the reason the expand pass is built the way it
is: fill pressure applied through the prompt is unsafe, because the prompt can
only ask. Padding has to be made _impossible_, not discouraged — which is why
every proposed addition must carry a verbatim `sourceQuote` that the server
checks against the candidate's own material, and why anything unquotable is
discarded before it ever reaches the generator.

Exits non-zero on any error, honesty violation, placeholder leak, or critical
lint finding, so it can gate a manual release check.

## Fit suite

```bash
npm run eval -- --suite fit
npm run eval -- --suite fit --corpus path/to/other.json --json out.json
```

Runs the analyzer over the harvested real-JD corpus and scores whether it
notices out-of-field applications. Reports two rates, because they are different
bugs: **mismatch detection** (out-of-field roles correctly flagged `unrelated`)
and **false alarms** (in-field roles wrongly flagged). A detector that flags
everything scores 100% on the first and is useless.

Only `match` and `mismatch` are scored. `adjacent` and `generic` are reported
but deliberately unscored — a marketing-adjacent analytics internship is
genuinely arguable, and grading arguable cases makes the headline number
meaningless.

### The strata are not ground truth

The corpus is stratified by each job board's own `classification` field, and
**the boards miscategorise**. Measured on the first full run: of 4 apparent
false alarms, 3 were postings the board filed under Information &
Communication Technology whose titles were "HR OJT / Intern" and "Marketing
OJT / Intern" — the model was right and the label was wrong. Re-scoring against
the job _title_ instead moved accuracy from 72%/81% to 78% on unambiguous
titles.

So treat the reported rates as a floor, not a measurement, and read the failing
cases before concluding anything:

```bash
node -e "const r=require('./out.json');
  for(const c of r.filter(x=>x.stratum==='mismatch'&&x.domainMatch!=='unrelated'))
    console.log(c.domainMatch, c.title, c.score)"
```

That is how the real weakness surfaced: `adjacent` was being used as a
comfortable middle for Finance and Accounting roles scoring 68–72, rather than
as the narrow "these fields share real method" category it is meant to be.
