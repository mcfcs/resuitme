# Resuitme — session handoff

Written 2026-09-15. Every number here was verified at the time of writing; the
commands to re-verify are given so you can distrust it cheaply.

---

## 1. Current state

```
branch        main, working tree CLEAN
HEAD          aa2590a  Document the fill work, including the result that must not be repeated
tests         393 passing (14 files)
typecheck     clean          lint clean          prettier clean
deployment    http://100.70.66.3:5581  (HTTP 200, live over Tailscale)
model         gpt-oss:20b @ http://100.102.10.69:11434, OLLAMA_THINK=low, NUM_CTX=32768
```

Re-verify with:

```bash
git log --oneline -5 && git status --short
npx tsc --noEmit && npx vitest run && npx prettier --check . && npx next lint
curl -s -o /dev/null -w "%{http_code}\n" http://100.70.66.3:5581/
```

### The five commits this session

| Commit    | What                                                                     |
| --------- | ------------------------------------------------------------------------ |
| `b12b366` | Page fill measured against what the source can support (`sourceCeiling`) |
| `5e34558` | Expand pass that cannot invent material (quote-verified additions)       |
| `9dd0aee` | Numeric grounding — rejects figures the profile does not support         |
| `7d41fbc` | LaTeX compile-validity lint + unified the build target constant          |
| `aa2590a` | Documentation, including the negative result                             |

---

## 2. The architecture, and the one idea behind it

`lib/prompts/build.ts` **already forbids** fabrication in rules 1 and 2
("NEVER invent... accomplishments", "NEVER fabricate duration / quantity /
count claims"). The model fabricates anyway.

**So every guarantee is enforced in code the model cannot route around.** This
is the single most important thing to understand before changing anything:

| Verifier                  | Guards                 | Mechanism                                                                                |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `lib/trim-loop.ts`        | one page               | compile, count pages, trim, accept/revert                                                |
| `lib/ats/quote-check.ts`  | expand additions       | every addition needs a verbatim profile quote; unquotable ones are discarded server-side |
| `lib/ats/number-check.ts` | invented figures       | every digit traced to the profile; one regeneration naming the offenders                 |
| `lib/ats/source-lint.ts`  | compile validity + ATS | static rules, zero false positives on all real templates                                 |

`runFitLoop` is already a multi-agent system — planner (`/api/tailor/verify`),
generator (`/api/build`), critic (compile + page count), second planner
(`/api/tailor/expand`) — with **orchestration in TypeScript, not in the model's
reasoning**. That is why 27 trim-loop tests run with mocked deps and no model.

### Negative result — do not repeat this experiment

Telling the model to fill the page (explicit floor + target band) was
implemented and measured across all ten fixtures:

| Metric             | Before | After    |
| ------------------ | ------ | -------- |
| Movable-case fill  | 74%    | **84%**  |
| One-page rate      | 10/10  | **9/10** |
| ATS mean           | 100    | **90**   |
| Honesty violations | 0      | **3**    |

The sparsest fixture invented _"tokenization for morphologically rich
languages"_ to satisfy the floor. **Reverted.** A model under length pressure
always has the option of making something up. Full write-up in
`evals/README.md`.

---

## 3. Measurements — and why you must not trust one run

Five full generation runs this session, on identical code between v2–v4:

|                  | baseline | v2   | v3   | v4   | v5        |
| ---------------- | -------- | ---- | ---- | ---- | --------- |
| Movable fill     | 74%      | 84%  | 86%  | 80%  | **85%**   |
| One-page         | 10/10    | 9/10 | 9/10 | 9/10 | **10/10** |
| must_include     | —        | 100% | 100% | 93%  | **100%**  |
| Invented figures | —        | —    | —    | 0    | **0**     |

Per-case swing on identical code: `adjacent-not-equal` 96 → 94 → **69**,
`fullstack-react-flask` 92 → 99 → **72**. **±25 points.**

> **Rule: average at least 3 runs before believing any fill or must_include
> number.** The stable signals — honesty violations, placeholder leaks,
> invented figures — were 0 across every run; a change in _those_ is real.

v5 was the best run and the first after the target-constant fix. I believe the
fix caused it. One run cannot prove that.

---

## 4. What is NOT done

### 4a. Qualitative invention (the main open problem)

The numeric check catches invented **quantities**. It does not catch invented
**qualitative** claims — _"led a team"_, _"at scale"_, _"cross-functional"_ —
which pass every existing check.

**A full plan exists** at `C:\Users\Spectre\.claude\plans\honest-claims-and-metrics.md`,
with these decisions already settled by the user:

- Ungrounded claims are **stripped silently**, then offered back via an
  optional panel. The résumé is honest with zero user effort; the user opts
  _in_ to enrichment, never out of honesty.
- Detection is **narrow** — leadership verbs, scale words, seniority
  implications only. A wrongly-flagged real achievement is worse than a missed
  invention.
- Supplied metrics **save to the profile permanently** (additive optional
  field, no migration — follow the `templateId` precedent in `lib/profile.ts`).
- The eval gains **`--runs N`** reporting mean ± spread.

Two questions were left open for the next session:

1. **Softening quality** — pure removal of the unsupported clause, or actual
   rewriting? Removal is safer; rewriting reads better and is harder.
2. **Sequencing** — `--runs N` first (boring, but makes phases 1–4 measurable)
   or user-visible work first?

### 4b. Smaller known items

- `profile-input-kind` intermittently trips its `sourceCeiling` tripwire; the
  declared 2,100 may be too low for how rich that source actually is.
- One honesty flag on `security-zero-trust` ("Network segmentation") comes from
  the analyzer's runtime judgment, not the fixture. Analyzer-side, pre-existing.
- `ml-engineer-strong` showed `—` for ATS in one run (remote compile service
  hiccup, not bad LaTeX).

---

## 5. Environment landmines

Both cost real time this session. Both are in project memory.

**Commit-charge exhaustion masquerading as unrelated bugs.**
`logioptionsplus_agent` (Logitech Options+) leaked **27.4 GB of commit charge**
while showing only 283 MB working set. Symptoms: `tsc` OOM, vitest dying with
`VirtualAlloc failed`, Docker Desktop failing to start with `0xc00000fd`. All
one cause. Diagnose by sorting processes by **PM (commit)**, not WS:

```powershell
Get-Process | Sort-Object PM -Descending | Select-Object -First 10 Id,ProcessName,@{n='CommitMB';e={[int]($_.PM/1MB)}},@{n='WorkingMB';e={[int]($_.WS/1MB)}}
```

Fix: `Stop-Process -Name logioptionsplus_agent -Force`, then relaunch it from
`C:\Program Files\LogiOptionsPlus\`. Comes back at ~80 MB.

**Never run `wsl --shutdown` to free memory** — Docker Desktop's engine _is_ a
WSL distro, and doing this broke Docker for an hour. Also: **never
blanket-kill node processes**; the user runs mangagi (Electron) alongside this.

Ollama runs on a **remote** host (`100.102.10.69`), so local memory pressure
does not affect inference. Never send `think:false` to gpt-oss — it crashes the
llama-server. Use `OLLAMA_THINK=low`.

---

## 6. Running it

```bash
npm run dev                                   # localhost:3000
./start-resuitme.bat                          # port 5581, Tailscale, frees the port first
npm run eval -- --suite generation            # ~10 min, needs the model host
npm run eval -- --suite generation --case X   # one fixture
```

The `.bat` kills only LISTENING PIDs on 5581, waits out TIME_WAIT, resolves the
tailnet IP, builds if `.next/BUILD_ID` is missing, and binds `0.0.0.0`.

**UI surface:** three pages (`/` tailor, `/build`, `/profile`) and 11
components. `components/HonestyPanel.tsx` is the proven pattern for asking the
user per-item questions and turning answers into hard constraints — model any
new such panel on it.
