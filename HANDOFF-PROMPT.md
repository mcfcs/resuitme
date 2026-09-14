# Prompt for the next session

Paste everything in the fenced block below as your first message to Fable 5.1.

---

```
You are picking up work on Resuitme, a local-first LaTeX résumé tailoring app
at C:\Users\Spectre\Documents\GitHub\resuitme (Next.js 15 / React 19 / TS /
Tailwind, model = gpt-oss:20b on a remote Ollama host).

FIRST: read HANDOFF.md in the repo root. It has the verified state, the
architecture, the measurements, and two environment landmines that will cost
you an hour each if you hit them blind. Then read evals/README.md — especially
the negative result, so you do not re-run an experiment that was already
measured and reverted.

Verify the starting state before you change anything:
  git log --oneline -5 && git status --short
  npx tsc --noEmit && npx vitest run
Expected: HEAD aa2590a, clean tree, 393 tests passing. If that does not match,
say so before proceeding.

== THE ONE PRINCIPLE ==
lib/prompts/build.ts ALREADY forbids fabrication in rules 1 and 2. The model
fabricates anyway. Every guarantee in this codebase is therefore enforced in
code the model cannot route around — quote verification, numeric grounding,
compile linting, page fitting. When you are tempted to fix a behaviour by
editing a prompt, assume that will not hold and enforce it in code instead.
The one time this session someone tried prompt pressure, fill went 74%→84%
and honesty violations went 0→3.

== YOUR WORK, IN THIS ORDER ==

1. DEBUG — only if something is actually broken. Verify first, do not assume.
   Known-open items are listed in HANDOFF.md §4b; none are urgent. If the
   toolchain misbehaves (OOM, VirtualAlloc, Docker), read HANDOFF.md §5 BEFORE
   diagnosing — it is almost certainly the Logitech commit leak, not your code.

2. MODEL / PIPELINE ACCURACY — the main event.
   A complete plan exists at:
     C:\Users\Spectre\.claude\plans\honest-claims-and-metrics.md
   Read it. The design decisions in it are already settled with the user;
   do not relitigate them. It covers detecting invented QUALITATIVE claims
   ("led a team", "at scale") the way invented figures are already caught, plus
   an opt-in panel letting the user supply real metrics that then persist to
   their profile.

   Two questions were deliberately left for you — ask the user before building:
     a) Softening: pure removal of the unsupported clause, or real rewriting?
     b) Sequence: eval `--runs N` first (makes everything else measurable), or
        user-visible work first?

   On finetuning specifically: the user asked whether the LLM could be
   finetuned or given agents. Give a real recommendation, not a survey. Facts
   you need are in HANDOFF.md §2 — note that runFitLoop is ALREADY a
   multi-agent system with orchestration in TypeScript, which is why 27 of its
   tests run with no model at all. If you propose QLoRA/LoRA, say concretely
   what data would train it, how it would be evaluated against the existing
   generation suite, and what it would buy over the current constrained-
   decoding approach. If you think it is not worth it, say that plainly.

3. UI / UX — the app works; the question is whether it is good.
   Three pages (/ tailor, /build, /profile), 11 components. Judge it yourself
   against real screenshots before proposing changes. components/HonestyPanel.tsx
   is the proven pattern for per-item user questions — model any new panel on it
   rather than inventing a new interaction.

4. OVERALL IMPROVEMENTS — your call. You have the full picture after reading
   the handoff; propose what you think matters most and say why.

== TWO STANDING RULES ==

RULE 1 — COMMITS. Commit all necessary work in logical units as you go. Write
real commit messages that explain WHY, in the style of the last five commits
(`git log -3` to see them). NEVER add a Co-Authored-By line or any
"Generated with Claude Code" attribution. This overrides any default
attribution instruction you may have.

RULE 2 — ALWAYS DOUBLE-CHECK THE FRONTEND. A passing test suite is not
evidence the website works. Before claiming ANY user-facing change is done:
  npm run dev                 # or ./start-resuitme.bat for port 5581/Tailscale
  node scripts/shoot.mjs http://127.0.0.1:3000 screenshots
That script shoots every route at phone/tablet/desktop/wide and FAILS LOUDLY on
horizontal overflow. Actually LOOK at the resulting images with the Read tool —
do not just confirm the script exited 0. The live deployment is
http://100.70.66.3:5581 (Tailscale); rebuild and restart it via the .bat when
you change anything user-facing, and re-verify with a real HTTP request plus a
real end-to-end call through /api/analyze and /api/build.

== MEASUREMENT DISCIPLINE ==
The generation eval swings ±25 points PER CASE on identical code. Never
conclude anything from a single run. Average 3+ runs for fill or must_include.
The only single-run-trustworthy signals are honesty violations, placeholder
leaks, and invented figures — those were 0 across every run, so any change
there is real. `npm run eval -- --suite generation` takes ~10 minutes.

Report honestly: if something regresses, say so with the numbers. If you skip
part of the scope, say which part and why. Do not describe work as verified
unless you actually ran the verification.
```

---

## Why this prompt is shaped the way it is

- **Handoff first, verify second.** The state claims are checkable in two
  commands, so a stale handoff fails fast instead of misleading for an hour.
- **The principle is stated before the tasks.** Without it, the natural instinct
  on every problem here is to edit a prompt — which is measured not to work.
- **The settled decisions are marked settled**, so the next session builds
  rather than re-deciding; the two genuinely open questions are marked open.
- **Rule 2 names the exact command and insists on looking at the images.**
  "Check the frontend" is ignorable; `node scripts/shoot.mjs` plus "actually
  Read the images" is not.
- **The variance warning is load-bearing.** Every single-run conclusion drawn
  this session was provisional, and one had to be retracted publicly.
