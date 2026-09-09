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
npm run eval -- --suite generation --template compact
npm run eval -- --suite generation --case cicd-implicit --json out.json
```

Scores the résumé the app actually **produces**, not just the analyzer's
opinion of the input. For each fixture it runs the real `/api/build` handler
through `lib/trim-loop.ts` — the same loop the app uses — then compiles and
scans the result.

Every metric is objective; there is no judge model, because a judge model's
opinion of a résumé is exactly the thing that cannot be verified.

| Metric                  | Why it matters                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------ |
| ATS score               | From the PDF text layer. Catches unextractable output.                               |
| Pages                   | Anything but 1 is a whole-pipeline failure.                                          |
| `must_include` coverage | Did the analyzer's ranked picks survive into the output?                             |
| Honesty violations      | Did a disclaimed keyword appear anyway? Any hit is a contract breach.                |
| Placeholder leaks       | The prompt promises zero; nothing else checks.                                       |
| Trims                   | Proxy for how well `targetChars` is calibrated for the layout.                       |
| Chars/Budget            | How full the page actually is. A low ratio means content is being left on the table. |

`must_include` coverage is the headline. The analyzer produces 3–5 specific
ranked picks, and those are now interpolated into the generation prompt — this
number is what turns "we think that helped" into evidence.

`--template <id>` runs the suite against a specific layout, which is how the
`targetChars` calibration for a new layout gets validated.

Exits non-zero on any error, honesty violation, placeholder leak, or critical
lint finding, so it can gate a manual release check.
