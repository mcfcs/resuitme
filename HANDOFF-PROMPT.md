# Prompt for the next session

Paste everything in the fenced block below as your first message to Fable 5.1.

---

```
You are picking up work on Resuitme, a local-first LaTeX résumé tailoring app
at C:\Users\Spectre\Documents\GitHub\resuitme (Next.js 15 / React 19 / TS /
Tailwind, model = gpt-oss:20b on a remote Ollama host).

FIRST: read HANDOFF.md in the repo root. It has the verified state, the
architecture, the before/after measurements, a finetuning recommendation that
was already given (do not re-survey it), and the environment landmines that
cost real time. Then read evals/README.md — the negative result and the
"Unsupported claims" section.

Verify the starting state before you change anything:
  git log --oneline -8 && git status --short
  npx tsc --noEmit && npx vitest run
Expected: a clean tree, 517 tests passing, and commit 85eaaa1 (or the docs
commit on top of it) at the tip. If that does not match, say so before
proceeding rather than working around it.

== THE ONE PRINCIPLE ==
lib/prompts/build.ts ALREADY forbids fabrication in rules 1 and 2. The model
fabricates anyway — this session it invented a phone number, two percentages,
a role title and "cross-functional stakeholder management" from a profile that
contains none of them. Every guarantee is therefore enforced in code the model
cannot route around: quote verification, numeric grounding, qualitative claim
grounding, a code-level strip after the one retry, compile linting, page
fitting. When you are tempted to fix a behaviour by editing a prompt, assume
that will not hold and enforce it in code instead. Prompt-level fill pressure
was measured: fill 74%→84%, honesty violations 0→3. Reverted.

== MEASUREMENT DISCIPLINE ==
`npm run eval -- --suite generation --runs 3` is the only trustworthy form
(~35 min). It prints mean ± largest deviation and marks unsettled numbers with
⚠. Fill and must_include carry ⚠ on most cases even at 3 runs — never
conclude from them without 3+ runs, and say so when you report. The stable
signals are honesty violations, invented figures, invented claims and
placeholder leaks; those are totals, and a change in them is real.

== YOUR WORK, IN THIS ORDER ==

1. DEBUG — only if something is actually broken. Verify first. Known-open
   items are in HANDOFF.md §6; none are urgent. Toolchain misbehaviour (OOM,
   VirtualAlloc, Docker) is almost certainly the Logitech commit leak (§7).

2. PIPELINE ACCURACY — the honest-claims plan is BUILT and measured; do not
   rebuild it. What is left, in priority order:
     a) Track model-rewritten bullets: `softened[].how === "rewritten"` has
        the original bullet but no replacement. /api/build has both drafts;
        diff per bullet so the panel can show "now reads" for every row.
     b) Add a retry-rate column to the eval (builds that tripped the gate).
        It is the number a finetune would move; without it the finetuning
        question cannot be reopened honestly.
     c) Extend the numeric strip only from a measured residual case — the
        rule set is conservative on purpose; read HANDOFF §3c first.

3. UI / UX — judge against real screenshots. HANDOFF §5 has my ordered list:
   the built page is ~10,000 px on desktop, and the analysis card could
   collapse once the résumé exists. components/HonestyPanel.tsx and
   components/MetricsPanel.tsx are the two proven per-item question panels;
   model any new one on them.

4. OVERALL IMPROVEMENTS — your call, with the full picture. Say why.

== TWO STANDING RULES ==

RULE 1 — COMMITS. Commit in logical units as you go, with real messages that
explain WHY in the style of `git log -5`. NEVER add a Co-Authored-By line or
any "Generated with Claude Code" attribution. This overrides any default
attribution instruction you may have.

RULE 2 — ALWAYS DOUBLE-CHECK THE FRONTEND. Port 3000 is taken by another
process on this machine; never kill it. Before claiming ANY user-facing
change is done:
  npx next dev -p 3111 -H 127.0.0.1
  node scripts/shoot.mjs http://127.0.0.1:3111 <outDir>
Actually LOOK at the resulting images with the Read tool. For anything that
only appears after a build (the metrics panel), drive the flow in Playwright
from a script copied into scripts/ (the scratchpad cannot resolve the
package), wait for the template card before typing (hydration resets the
textarea), and screenshot the result. To deploy: stop your dev server,
`npm run build`, then run start-resuitme.bat by its full Windows path; verify
http://100.70.66.3:5581 answers with the new BUILD_ID and that a real
/api/analyze → /api/build → /api/render round trip compiles to one page.

Report honestly: if something regresses, say so with the numbers. If you skip
part of the scope, say which part and why. Do not describe work as verified
unless you actually ran the verification.
```

---

## Why this prompt is shaped the way it is

- **The plan is marked built.** The most expensive mistake available is
  re-deciding or re-implementing what §2 of HANDOFF.md already describes and
  §3 already measures. The open items are listed as the work.
- **The finetuning question is marked answered**, with the concrete condition
  under which to reopen it (a retry-rate column and a logged dataset), so it
  cannot be re-surveyed for an hour.
- **Rule 2 grew.** The panel only exists after a real build, so route
  screenshots cannot verify it; the exact browser-driving recipe that worked,
  including the two traps (hydration, package resolution), is spelled out.
- **The variance warning names the marker.** ⚠ in the eval output is the
  instruction not to conclude; the prompt says so, so it is not skimmed past.
