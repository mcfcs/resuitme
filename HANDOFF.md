# Resuitme — session handoff

Written 2026-09-15 (second session). Every number here was verified at the
time of writing; the commands to re-verify are given so you can distrust it
cheaply. The previous handoff's content is folded in, not replaced.

---

## 1. Current state

```
branch        main, working tree CLEAN
HEAD          the five commits in §1a on top of 8dd18fe; see `git log --oneline -8`
tests         517 passing (21 files)
typecheck     clean          lint clean          prettier clean
deployment    http://100.70.66.3:5581  (HTTP 200 over Tailscale, serving BUILD_ID wZuXRcIn_Xk4UjyMYHFPr)
model         gpt-oss:20b @ http://100.102.10.69:11434, OLLAMA_THINK=low, NUM_CTX=32768
```

Re-verify with:

```bash
git log --oneline -8 && git status --short
npx tsc --noEmit && npx vitest run && npx prettier --check . && npx next lint
curl -s -o /dev/null -w "%{http_code}\n" http://100.70.66.3:5581/
```

### 1a. The five commits this session

| Commit    | What                                                                                         |
| --------- | -------------------------------------------------------------------------------------------- |
| `4646a7f` | `--runs N` on the generation eval: mean ± spread, ⚠ on unsettled numbers, totals for honesty |
| `d45b569` | `lib/ats/claim-check.ts` — qualitative claim detection with a code-level softening rewrite   |
| `df6f1ea` | `/api/build` gates on claims too, retries once, then strips in code; `Profile.metrics` field |
| `7bf7460` | Claims column in the eval report                                                             |
| `85eaaa1` | Metrics panel, grouped by bullet; profile list of confirmed metrics; shared bullet locator   |

---

## 2. The architecture, and the one idea behind it

`lib/prompts/build.ts` **already forbids** fabrication in rules 1 and 2. The
model fabricates anyway. Measured again this session, from `sampleresume.tex`,
which contains none of these: _"led a team"_, _"cross‑functional stakeholder
management"_, _"increased gross margin by 12% and inventory turnover by 18%
over 18 months"_, _"Founder & Lead Developer"_, and a header phone number
`+1 555-123-4567`.

**So every guarantee is enforced in code the model cannot route around.**

| Verifier                  | Guards                       | Mechanism                                                                                    |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `lib/trim-loop.ts`        | one page                     | compile, count pages, trim, accept/revert                                                    |
| `lib/ats/quote-check.ts`  | expand additions             | every addition needs a verbatim profile quote; unquotable ones are discarded server-side     |
| `lib/ats/number-check.ts` | invented figures             | every digit traced to the profile; **new:** `stripUngroundedNumbers` removes what survives   |
| `lib/ats/claim-check.ts`  | **invented qualities (new)** | leadership / scale / seniority / duration vs an explicit synonym map; `softenClaims` rewrite |
| `lib/ats/source-lint.ts`  | compile validity + ATS       | static rules, zero false positives on all real templates                                     |

### 2a. How `/api/build` uses them now

```
first      := generate()
gate(first) = findUngroundedNumbers + findUngroundedClaims
if clean   → return { latex }                                  // 0 extra cost
retry      := generate(naming every figure and claim)          // ONE retry, shared
chosen     := retry if it invents no more of either and less of one, else first
chosen     := softenClaims(chosen)      // re-head / delete / drop bullet
chosen     := stripUngroundedNumbers(chosen)   // phone + separator, "by 15%", "a 30% reduction"
return { latex, softened[], ungroundedNumbers, honestyRetry }
```

`softened` is everything the model first reached for and how it left the
page (`rewritten` by the retry, `stripped` by code, `dropped` with its
bullet). It is what the metrics panel offers back.

**The pool a qualitative claim is grounded in is the candidate's own words
only.** The analysis context is model-written; a model-written "led the team"
grounding another model-written "led the team" is the loop the gate exists to
break. Figures keep the wider pool because the analyzer quotes the candidate's
own numbers back.

### 2b. The opt-in half

`components/MetricsPanel.tsx`, collapsed under the built résumé, one row per
bullet. "It's true — keep it" or a real figure → `lib/metrics.ts` turns the
answers into `ProfileMetric`s → saved to `Profile.metrics` (additive optional,
`templateId` precedent) → rendered into the pool by `metricsToText` → one
rebuild. A confirmed metric grounds itself from then on and is never asked
again. `components/profile/MetricsList.tsx` shows and removes them.

What gets saved never carries the invented figure: the claim is the bullet
with the figure removed, and the anchor is the bullet **as shipped**. An
anchor carrying the invented "15%" would have grounded that very figure on
the next build — found and pinned by test.

### 2c. Things learned the hard way this session

- The model writes `cross‑functional` and `hands‑on` with **U+2011**, a
  non-breaking hyphen. Every scan folds hyphen-like code points to ASCII
  first. Check for this before adding any new phrase pattern.
- A finding's evidence must be the **bullet**, not a text window. The first
  panel showed `…18 months.} \resumeItemListEnd \resumeSubhe`. Both checks
  now resolve to the enclosing `\resumeItem{...}` via `lib/ats/bullets.ts`.
- The model will invent a **role title** (`Founder & Lead Developer`) inside a
  `\resumeSubheading`, not just bullets. The title pattern catches it; the
  line fallback in the bullet locator is what makes that reportable.
- `parseImport` was silently dropping `templateId`. Fixed while adding
  `metrics`; the round-trip test now covers both.

### Negative result — do not repeat this experiment

Unchanged from the first session: prompt-level fill pressure raised fill
74%→84% and produced 3 honesty violations and a 9/10 one-page rate. Full
write-up in `evals/README.md`. **Reverted.**

---

## 3. Measurements

### 3a. `--runs 3` is the unit of measurement now

Five single runs last session were provisional; one conclusion had to be
retracted. `npm run eval -- --suite generation --runs 3` now prints
`mean ± largest deviation`, marks any range above 10 points with ⚠, and
**totals** honesty counts rather than averaging them. ~35 minutes on the
local host. Read `⚠` as "not settled".

### 3b. Before (route at `4646a7f`, 3 runs, 30 builds)

| Case                   | ATS    | 1-page | must_include | Honesty | Figures | Placeholders | Fill               |
| ---------------------- | ------ | ------ | ------------ | ------- | ------- | ------------ | ------------------ |
| adjacent-not-equal     | 100 ±0 | 2/3    | 100% ±0      | **2**   | 0       | 0            | 88% ±12⚠           |
| cicd-implicit          | 99 ±0  | 3/3    | 100% ±0      | 0       | 0       | 0            | 38% ±1 (94% ±3)†   |
| data-engineer-spark    | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0            | 87% ±4             |
| fullstack-react-flask  | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0            | 81% ±16⚠           |
| leadership-implicit    | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0            | 86% ±11⚠           |
| mismatch-senior-devops | 100 ±0 | 2/3    | 89% ±22⚠     | 0       | 0       | 0            | 95% ±12⚠           |
| ml-engineer-strong     | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0            | 86% ±20⚠           |
| profile-input-kind     | 96 ±3  | 3/3    | 100% ±0      | 0       | 0       | **2**        | 59% ±4 (96% ±7⚠)†  |
| security-zero-trust    | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0            | 78% ±17⚠           |
| sparse-resume-nlp      | 99 ±0  | 2/3    | 100% ±0      | 0       | 0       | 0            | 34% ±2 (96% ±6⚠)†  |
| **mean**               | 99 ±0  | 27/30  | 99% ±2       | 2 total | 0 total | 2 total      | 86% ±2 (7 movable) |

The old route regenerated 4 times in 30 builds; an invented phone number
appeared twice. Figures in the _final_ output were 0 only because the retry
happened to comply each time — nothing after the retry could act.

### 3c. After (route at `85eaaa1`, 3 runs, 30 builds)

| Case                   | ATS    | 1-page | must_include | Honesty | Figures | Claims  | Placeholders | Fill                 |
| ---------------------- | ------ | ------ | ------------ | ------- | ------- | ------- | ------------ | -------------------- |
| adjacent-not-equal     | 100 ±0 | 3/3    | 89% ±22⚠     | **1**   | 0       | 0       | 0            | 90% ±36⚠             |
| cicd-implicit          | 99 ±0  | 3/3    | 100% ±0      | 0       | 0       | 0       | 0            | 36% ±1 (89% ±3)†     |
| data-engineer-spark    | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0       | 0            | 75% ±29⚠             |
| fullstack-react-flask  | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0       | 0            | 81% ±15⚠             |
| leadership-implicit    | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0       | 0            | 78% ±11⚠             |
| mismatch-senior-devops | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0       | 0            | 96% ±20⚠             |
| ml-engineer-strong     | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0       | 0            | 92% ±5               |
| profile-input-kind     | 96 ±3  | 3/3    | 100% ±0      | 0       | 0       | 0       | **2**        | 59% ±2 (97% ±2)†     |
| security-zero-trust    | 100 ±0 | 3/3    | 100% ±0      | 0       | 0       | 0       | 0            | 92% ±3               |
| sparse-resume-nlp      | 99 ±1  | 3/3    | 100% ±0      | 0       | 0       | 0       | 0            | 28% ±4 (81% ±12⚠)†   |
| **mean**               | 99 ±0  | 30/30  | 99% ±2       | 1 total | 0 total | 0 total | 2 total      | 86% ±11⚠ (7 movable) |

The new gate fired **19 times in 30 cases** (the retry rate a finetune would
have to move — §4). What it caught, all verified absent from the fixtures:
`cross-functional` + `stakeholder` ×5, `large-scale` ×4, `Managed` ×3,
`Oversaw`, `Senior developer`, and figures `+1 555 123 4567`,
`+63 917 123 456`, `12%`, `30%`. Residual after the code strip: **0 claims,
0 figures**, in every run. Raw results: run the command; the JSON of this
run is in the session scratchpad, not the repo.

### 3d. What the two tables do and do not show

- **The ship criteria hold.** Claims 0, figures 0, must_include unchanged at
  99% ±2, one-page 30/30 (was 27/30), movable fill mean unchanged at 86%.
- **Fill's spread widened** from ±2 to ±11 on the suite mean, and
  `adjacent-not-equal` swung ±36. Stripping removes characters and the retry
  produces a different draft, so more variance is expected; whether the mean
  moved cannot be read from three runs. Do not read a 2-point change as real.
- The stable signals are honesty, figures, claims, placeholders. Those are
  the numbers to compare, and they went 2→1, 0→0, (new) 0, 2→2.
- Two baseline honesty hits on `adjacent-not-equal` and two placeholder leaks
  on `profile-input-kind` are **pre-existing** (analyzer-side and
  template-side respectively; §4b).

---

## 4. Finetuning and agents — the recommendation

**Do not finetune now.** Plainly, and for four reasons that are each
sufficient:

1. **There is nothing to train on.** Ten fixtures. The failure being fought is
   fabrication under length pressure, which is a property of the objective,
   not of the model's style. A LoRA lowers a _rate_; it cannot make it zero,
   so every code guard stays regardless. That means a finetune only moves the
   pre-gate rate — the thing that costs one retry (~30 s) on the fraction of
   builds that trip the gate.
2. **It cannot be measured with the instrument we have.** The eval swings ±25
   per case; `--runs 3` narrows fill to ±2 on the suite mean but leaves most
   cases ⚠. A finetune's effect on fill or `must_include` would need ~10 runs
   per condition to detect. The stable metrics are already 0 by construction.
3. **The serving cost is real.** `gpt-oss:20b` is an MoE with MXFP4 weights;
   QLoRA needs the unquantised checkpoint and more than the ~20 GB usable on
   the 24 GB host, which is already at its VRAM cliff for inference. A merged
   adapter has to be re-exported to GGUF for Ollama. That is a week, not an
   afternoon.
4. **The agent system already exists.** `runFitLoop` is planner → generator →
   critic → second planner with orchestration in TypeScript; 27 of its tests
   run with no model. The bottleneck is not missing agents, it is that every
   agent runs on the same 20B model because a second resident model would
   evict the first (`OLLAMA_MODEL_FAST` is deliberately the same id).

**What would make it worth revisiting**, and the cheap thing to do first:

- Log every build's `(prompt, first draft, gate verdict, accepted draft)`.
  After a few hundred real builds that is a preference dataset for free —
  accepted vs rejected drafts, labelled by code, not by a judge model.
- The metric a finetune would move is the **retry rate** (builds that trip the
  gate) and the first-pass one-page rate. Add both as columns before training
  anything, so the "after" can be read off `--runs 3`.
- If the retry rate is above ~30% by then and the dataset exists, train a
  QLoRA on a small dense model (Qwen3-8B class) as the _generator only_,
  keep gpt-oss for analysis, and accept the evict/reload cost or add VRAM.
  Success = retry rate below 10% with honesty/figures/claims still 0 across
  `--runs 3`. If it does not clear that bar it is not worth the second model.

---

## 5. UI / UX — judged against screenshots

`node scripts/shoot.mjs http://127.0.0.1:3111 <dir>`: 12 shots, no overflow,
no contrast failures. Plus three real browser runs of the build flow with
the metrics panel open (phone and desktop) and one apply-and-rebuild.

What is good: the typeset-sheet system holds up at every width; the build
flow reads top to bottom as analysis → honesty → build → result without a
mode switch; the honesty and metrics panels share one vocabulary.

What I would change next, in order:

1. **The result page is long.** On desktop the built flow is ~10,000 px:
   fit analysis, honesty panel, built rating, LaTeX, ATS report, metrics
   panel. The first analysis card could collapse once the résumé exists.
2. **The metrics panel's "Now reads" line only appears for code strips.**
   When the model reworded a bullet, the user cannot see the new form. The
   route could diff first vs chosen draft per bullet; it has both.
3. **`/profile` has no empty state for confirmed metrics**, by design (the
   list appears only once one exists). Fine, but the build page should hint
   that confirmations persist — it says so only inside the collapsed panel.
4. The phone tab bar renders mid-page in full-page screenshots; that is a
   capture artefact of a fixed element, not a bug. Do not chase it.

---

## 6. What is NOT done

### 6a. Open from the plan

- **Model-rewritten bullets are not tracked** (see §5.2). `how: "rewritten"`
  entries carry the original bullet but no replacement.
- **Residual figures that no strip rule fits would still ship**, counted in
  `ungroundedNumbers`. Measured residual across 30 builds: 0. The rule set is
  deliberately conservative; extend it only from a measured case.
- **Retry rate is 19/30.** Each retry is ~30 s. That is the cost of the gate
  today and the number to watch; the eval does not yet print it (§4).
- Grounding is **document-level**: a leadership verb transplanted from one
  item to another passes. Accepted on purpose (false positives are worse).

### 6b. Smaller known items (carried over)

- `profile-input-kind` intermittently trips its `sourceCeiling` tripwire and
  leaks 2 placeholders in some runs; the declared 2,100 may be too low.
- Two honesty flags on `adjacent-not-equal` ("azure data services" class)
  come from the analyzer's runtime judgment, not the fixture.
- `ml-engineer-strong` occasionally shows `—` for ATS (remote compile hiccup).

---

## 7. Environment landmines

Both from the first session are still true (Logitech commit leak; never
`wsl --shutdown`; never blanket-kill node — mangagi runs alongside). New:

- **Port 3000 is held by an unrelated process.** Use `npx next dev -p 3111
-H 127.0.0.1` and pass the URL to `scripts/shoot.mjs`.
- **Playwright scripts in the scratchpad cannot resolve `playwright`.** Copy
  them into `scripts/` as `*.tmp.mjs`, run, delete.
- **`start-resuitme.bat` only builds when `.next/BUILD_ID` is missing.** To
  deploy a change: stop your dev server (it shares `.next`), `npm run build`,
  then run the .bat with its full Windows path from Bash
  (`cmd //c "C:\\...\\start-resuitme.bat"`); a bare name is not found.
- A browser automation that types before React hydrates gets its input
  reset. Wait for a post-hydration element (the template card) first.

Ollama runs on a **remote** host; local memory pressure does not affect
inference. Never send `think:false` to gpt-oss. Use `OLLAMA_THINK=low`.

---

## 8. Running it

```bash
npm run dev                                   # localhost:3000 — see §7, use -p 3111
./start-resuitme.bat                          # port 5581, Tailscale
npm run eval -- --suite generation --runs 3   # ~35 min, the only trustworthy form
npm run eval -- --suite generation --case X   # one fixture, one run
```

**UI surface:** three pages (`/` tailor, `/build`, `/profile`) and 13
components. `components/HonestyPanel.tsx` and `components/MetricsPanel.tsx`
are the two per-item question panels; model any new one on them.
