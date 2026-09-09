# Fine-tuning plan

**Status: deferred, deliberately. Not started.**

This document exists so the decision is reviewable and the work is ready to
execute the moment the evidence justifies it. The reasoning for _not_ training
yet is as much the deliverable as the plan itself.

---

## Why not now

**1. The usual reason to fine-tune does not apply here.**

The most common justification for fine-tuning a small model is unreliable
structured output. That problem does not exist in this codebase: every JSON
route goes through `completeJson()`, which sets `body.format = schema`
(`lib/llm.ts`). Ollama compiles that schema into a GBNF grammar and constrains
decoding, so a malformed or incomplete object is not merely unlikely — it is
unrepresentable. Training to improve schema adherence would be optimising
something already guaranteed.

**2. The base model has not plateaued.**

The 2026 consensus sequence is prompt → RAG → fine-tune → distil, and the
standing advice is to train only once a real evaluation harness shows the base
model has stopped improving. This project has that harness, and it says there is
headroom left:

| Metric                        | Baseline (`gpt-oss:20b`) |
| ----------------------------- | ------------------------ |
| ATS score                     | 100 mean                 |
| One-page                      | 10/10                    |
| `must_include` coverage       | 98%                      |
| Placeholder leaks             | 0                        |
| Mismatch detection (real JDs) | see README               |

Those are not the numbers of a model at its ceiling.

**3. The actual defect is a prompting problem.**

The measured weakness is page fill: output averages ~62% of the available
character budget (range 30–91%). Every résumé fits one page, but several stop
well short and leave real experience unused. That is a content-selection
instruction problem, and prompt iteration should be exhausted on it before any
weights are touched.

---

## The gate

Train only when **all** of these hold:

1. The generation and fit suites show a metric that repeated prompt iteration
   cannot move.
2. That metric matters to the user's outcome, not just to the scoreboard.
3. There are ≥500 curated training pairs available from the corpus.

If a prompt change fixes it, that is the better fix: it is inspectable,
revertible, and costs no VRAM.

---

## Method: QLoRA via Unsloth

**This is not a free choice.** `gpt-oss:20b` ships in MXFP4, and MXFP4 kernels
do not implement a backward pass. Every training path other than Unsloth
upcasts the weights to bf16 first, which needs roughly **44 GB** of VRAM —
impossible on this box. Unsloth trains the 20B in **~14–16 GB**.

The host has ~20 GB usable of 24 GB, with a hard performance cliff past it (see
the VRAM measurements in the README). 14–16 GB fits, but the margin is thin:
**nothing else may be resident on the GPU during a run.** Stop Ollama first.

```
Base:        gpt-oss:20b (MXFP4)
Adapter:     LoRA r=16, alpha=32, dropout 0.05
Targets:     q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj
Context:     4096 (the prompts are long; do not shrink this)
Batch:       1 with grad-accum 8
LR:          2e-4, cosine, warmup 10
Epochs:      2-3 — more overfits at this dataset size
Precision:   4-bit base, bf16 compute
```

## Data

**Source:** the 90-JD real corpus (`evals/corpus/real-jds.json`, harvested by
`evals/harvest-jds.py`) crossed with profile variants. That corpus was built
stratified precisely so it can serve here — it is not throwaway eval data.

**Target 500–2,000 curated pairs.** At this scale curation beats volume: 500
good examples outperform 50,000 noisy ones. Generate candidates, then keep only
those the existing harness already scores well — ATS 100, one page,
`must_include` coverage 100%, zero honesty violations. **The eval harness is the
data filter.** Never train on unfiltered model output; that compounds the
model's existing errors instead of correcting them.

**What to train:** judgment, not format.

- Fit verdicts — `domain_match` in genuinely ambiguous cases, and naming
  `transferable` evidence that is specific rather than generic.
- Bullet selection and compression — the thing behind the page-fill defect.

**What NOT to train:** the JSON shape (grammar-constrained already), the LaTeX
syntax (measurably fine), or the honesty rules (better as hard constraints than
as learned tendencies — a constraint can be audited, a tendency cannot).

## Export and deploy

```
save_method="mxfp4"   →  GGUF  →  ollama create resuitme-tuned -f Modelfile
```

MXFP4 native merge keeps the file ~75% smaller and converts to GGUF far faster
than a bf16 merge. Once it is an Ollama model, `OLLAMA_MODEL=resuitme-tuned`
is the only change needed — the provider layer in `lib/llm.ts` is unchanged,
and `npm run eval -- --model resuitme-tuned` compares it directly against the
base.

## Verification

Run the same suites before and after, on the same corpus:

```bash
npm run eval -- --suite fit        --json before-fit.json
npm run eval -- --suite generation --json before-gen.json
# ... train, export, point OLLAMA_MODEL at the adapter ...
npm run eval -- --suite fit        --model resuitme-tuned --json after-fit.json
npm run eval -- --suite generation --model resuitme-tuned --json after-gen.json
```

**Keep the adapter only if it wins on the metric it was trained to fix and
regresses nothing else.** A fine-tune that improves page fill while dropping
`must_include` coverage or introducing an honesty violation is a loss, not a
trade — the honesty contract is the product.

Watch particularly for catastrophic forgetting of the honesty rules. They are
the most likely casualty of training on generation quality, and the eval's
`honestyViolations` count is the tripwire.
