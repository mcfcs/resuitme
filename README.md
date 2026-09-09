# Resuitme

Paste your LaTeX resume and a job description. Get a rating, a tailored rewrite, and a download-ready `.tex` file.

> **Default backend: a self-hosted Ollama model (`gpt-oss:20b`).** Nothing is sent to a hosted model API unless you explicitly set `LLM_PROVIDER=anthropic`. There is no per-token cost and your résumé stays on your network. The Anthropic API is a supported drop-in alternative, not the default.

Runs on a **self-hosted Ollama** model by default, so there is no per-token API cost and your résumé never leaves your network. The Anthropic API remains available as a drop-in alternative.

## Setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local — see "Model backend" below
npm run dev
```

Then open http://localhost:3000.

Check your backend wiring at any time: **http://localhost:3000/api/health** reports the provider, the model, whether the host is reachable, and whether the configured model is actually pulled.

## Model backend

### Ollama (default)

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://100.102.10.69:11434
OLLAMA_MODEL=gpt-oss:20b
OLLAMA_NUM_CTX=32768
OLLAMA_THINK=low
```

On the machine running Ollama:

```bash
ollama pull gpt-oss:20b

# Remote access: Ollama binds to 127.0.0.1 unless told otherwise.
# Windows: setx OLLAMA_HOST "0.0.0.0"  then restart Ollama
# Linux:   systemctl edit ollama  ->  Environment="OLLAMA_HOST=0.0.0.0"
# ...and allow TCP 11434 through the firewall.
```

### Choosing a model — keep weights + KV cache under usable VRAM

The one hard constraint is that the model **plus its KV cache** must fit in VRAM. Windows does not fail an oversized allocation: the NVIDIA driver silently backs the overflow with system RAM over PCIe, and Ollama still reports the model as 100% GPU-resident. The only symptom is that generation gets roughly 7x slower.

Measured on an RTX 5090 Laptop (24 GB), sweeping `num_ctx` on a single 8B model so that only the footprint changes:

| Total VRAM in use | Generation speed |
| ----------------- | ---------------- |
| 5.5 GB            | 129 tok/s        |
| 12.9 GB           | 127 tok/s        |
| 16.7 GB           | 126 tok/s        |
| 19.5 GB           | 127 tok/s        |
| **20.5 GB**       | **18 tok/s**     |

So **usable VRAM is ~20 GB of the 24** — the rest is the normal desktop/compositor reserve. Speed is completely flat right up to the edge and then falls off a cliff; there is no gradual degradation to warn you.

The practical rule: **stay under ~19.5 GB total, and treat anything above that as a hard error.** Within the limit, a bigger model is simply better — there is no speed penalty for using more of the card.

Two models were measured end-to-end on this app's actual routes:

| Model                         | @32k ctx | raw speed | `/api/analyze` | `/api/tailor` |
| ----------------------------- | -------- | --------- | -------------- | ------------- |
| **`gpt-oss:20b`** (MXFP4)     | 12.0 GB  | 146 tok/s | **9.4s**       | **3.8s**      |
| Qwen3-Coder-30B-A3B (Q4_K_XL) | 19.4 GB  | 195 tok/s | 15.5s          | 2.9s          |

**`gpt-oss:20b` is the recommended default.** Despite the lower raw token rate it is faster on the analysis route, uses 7 GB less VRAM (leaving real headroom below the cliff), and was more accurate on the judgment that matters most here: given a résumé whose bullets mention a GitHub Actions CI pipeline, it correctly placed CI/CD in `present`, while the 30B put it in `missing`. That distinction is not cosmetic — the app converts analyzer-flagged missing keywords into hard "never mention this" constraints, so a false negative actively suppresses real experience from your tailored résumé.

Both models respected the honesty constraints and produced the correct canonical section order.

Larger context or a bigger model is fine as long as you stay under ~19.5 GB. To buy margin, drop `OLLAMA_NUM_CTX` or halve the KV cache on the Ollama host:

```bash
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
```

### Reasoning effort matters more than model size

`gpt-oss` is a reasoning model: it emits thinking tokens _before_ any answer, and `num_predict` caps thinking and answer **combined**. Setting `OLLAMA_THINK=low` was the single biggest speedup measured:

| `OLLAMA_THINK` | `/api/analyze` | `/api/tailor` |
| -------------- | -------------- | ------------- |
| `medium`       | 22.8s          | 37.9s         |
| `low`          | **9.4s**       | **3.8s**      |

Output quality was unchanged — same valid LaTeX, same honesty compliance, same section order. Leave it at `low`.

> **Never set `OLLAMA_THINK=false` with gpt-oss.** It crashes the llama-server subprocess outright (`CUDA error: shared object initialization failed`) and takes the model host down until it restarts, which then surfaces as unrelated-looking failures on the next few requests. Use `low` to minimize reasoning.

> If inference is ever inexplicably slow, check `size_vram` via `/api/ps` **and** confirm nothing else is using the GPU. Transient contention from another workload produces exactly the same symptom as an oversized model, and is easy to misdiagnose as one.

Two more things that specifically bite on a local backend:

- **`OLLAMA_NUM_CTX` must be set.** Ollama defaults to a 4096-token window and silently truncates anything beyond it. This app routinely sends 8k–15k tokens (résumé + JD + parsed profile), so an unset value would quietly discard the system prompt's rules and produce baffling output.
- **Keep `OLLAMA_MODEL_FAST` unset** unless both models fit in VRAM at once. Otherwise Ollama evicts and reloads between calls, and a reload costs ~30s — far more than the smaller model saves.

### Anthropic

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else is identical; `lib/llm.ts` normalizes the two providers, including the difference in how each takes a JSON Schema.

## Install on a phone

The app is a PWA and installs to the iOS or Android home screen:

- **iOS (Safari):** Share → _Add to Home Screen_. Launches fullscreen with no browser chrome, using the marigold-on-ink app icon.
- **Android (Chrome):** menu → _Install app_ / _Add to Home screen_.

To use it from your phone against a dev server on your computer, bind the dev server to your LAN:

```bash
npm run dev -- -H 0.0.0.0
# then visit http://<your-computer-ip>:3000 from the phone
```

> **This exposes the API to your whole network.** `/api/render` becomes an open proxy to a third-party LaTeX compiler (and forwards résumé text to it), and `/api/analyze` becomes an open proxy to your GPU. Set `APP_ACCESS_TOKEN` in `.env.local` before doing this — every `/api/*` request then needs an `x-app-token` (or `Authorization: Bearer`) header, and the check is a no-op when the variable is unset. A per-IP rate limit on `/api/analyze` (30/min) and `/api/render` (60/min) is always on. See `.env.local.example`. This is a deterrent sized to a home LAN, not authentication — anything genuinely public belongs behind a reverse proxy with TLS.

Note that `navigator.clipboard` is unavailable on plain-HTTP origins in some mobile browsers; the Copy button falls back to a legacy copy path so it still works over LAN.

## How it works

**Tailor mode** (`/`) — paste an existing résumé:

1. Paste your LaTeX résumé and the target job description.
2. **Analyze résumé** — the model scores fit (0–100) and reports strengths, gaps, missing keywords, and suggested edits.
3. **The honesty check** — for every keyword the JD wants but your résumé lacks, mark _I have this_ / _Partial_ / _I don't_. Anything marked "I don't" is a hard constraint: it will never appear in the output, even implicitly.
4. **Tailor** — the model rewrites the LaTeX in place (preserving your preamble and packages), the draft is compiled to count its real page count, and over-long drafts go through a verify-and-trim loop until they fit one page.
5. **The ATS check** — the finished PDF is scanned and scored on what a résumé parser actually extracts from it (see below).
6. Copy the LaTeX, download `.tex`, or open it straight in Overleaf for a PDF preview.

**Build mode** (`/build`) — compose a résumé from scratch out of your saved profile and CV, targeted at one job. Pick a layout (below); the analyzer's ranked "must include" picks are fed to the composer as hard priorities.

**Profile** (`/profile`) — your source of truth. Paste a base résumé, a longer CV, and free-form skill notes; they get merged into one deduplicated profile. You can also describe a new experience and have it polished into CV-quality prose and inserted into your CV LaTeX, matching the file's existing macros.

Expect a full tailor run to take a few minutes on a local model: it is several sequential model passes, not one.

## The fit check

Before it writes anything, the analyzer decides whether you belong in the role
at all — and says so.

A score alone cannot carry that. It conflates "weak but plausible" with "you are
a computer science student applying to a human resources role", and the app
previously acted on neither: the number only tinted a pill, and the résumé got
built regardless. The analyzer now returns a structured verdict:

| Field             | What it answers                                           |
| ----------------- | --------------------------------------------------------- |
| `domain_match`    | `direct` / `adjacent` / `unrelated` — is this your field? |
| `seniority_match` | `at` / `below` / `above`                                  |
| `transferable`    | Named, specific things that genuinely carry across a gap  |
| `disqualifying`   | Requirements no rewrite can satisfy — a licence, a degree |

On an out-of-field role you get told plainly, before the build step, what
transfers and what does not. **It never blocks.** Profiles under-describe
people, career changers exist, and the analyzer is not infallible — so it
informs the decision instead of making it. The generator also sees the verdict,
and on a weak match leads with transferable evidence rather than imitating the
vocabulary of a field you have not worked in.

Measured against real job postings — see _Fit against real jobs_ below.

## The ATS check

Most advice about LaTeX and ATS is folklore. This app measures instead: it
extracts the text layer from the compiled PDF — the exact thing a parser reads —
and scores it as a transparent, itemised deduction. You can expand **"the text a
parser extracts"** to read the output verbatim.

| Check                         | Weight | What it catches                               |
| ----------------------------- | ------ | --------------------------------------------- |
| Text is extractable           | 30     | Image-only or outlined-font PDFs              |
| Characters survive extraction | 25     | Glyphs that decode to control codes           |
| Single-column flow            | 20     | Multi-column layouts a parser interleaves     |
| Reading order is preserved    | 10     | Rows whose stream order is scrambled          |
| Recognizable section headings | 10     | Headings a parser can map to fields           |
| Contact details are parseable | 5      | Whether your email survives as matchable text |

A second, instant check lints the LaTeX source with no compile at all, flagging
`multicol`, missing `glyphtounicode`, icon fonts, images, and characters known
to decode badly.

Two findings from building this, both measured rather than assumed:

- **The widely repeated ligature warning did not apply here.** `glyphtounicode`
  plus `\pdfgentounicode=1` already make "financial" and "Flask" extract
  correctly. Several "fixes" for it would have been pure churn.
- **A peso sign was the one real defect.** `₱53M` extracted as a control
  character, silently destroying a quantified achievement — invisible on the
  page, invisible in the LaTeX, and only visible in the extracted text.

Beware `pdftotext` as a checking tool: it reported every bullet in this résumé
as a replacement character, which was its own font-mapping artifact, not a
defect in the PDF.

## Layouts

All layouts are **single-column on purpose**. Two-column designs (AltaCV, Deedy
and similar) look sharper but interleave a sidebar into your work history when a
parser linearizes the page, so they are deliberately not offered.

| Layout       | Best for                                                                                         | One-page capacity |
| ------------ | ------------------------------------------------------------------------------------------------ | ----------------- |
| **Classic**  | Default. Standard sections, 11pt.                                                                | ~3,900 chars      |
| **Compact**  | More experience than fits. 10pt, tighter leading.                                                | ~4,400 chars      |
| **Academic** | Research and graduate applications. Education-first, with real Publications and Awards sections. | ~3,900 chars      |

Compact is measured, not estimated: rendering identical content, its body
occupies 615pt of vertical space where Classic needs 700pt — about 12% more
content on the same page, without cutting anything.

## Privacy

Résumé and JD text goes to whichever backend you configured — a local Ollama host keeps it on your network; the Anthropic backend does not. Either way, nothing is stored server-side, and profile data lives only in your browser's `localStorage`.

Because `localStorage` is the only copy, **use "Export profile" on the profile page to back it up.** It downloads the merged profile as JSON, and "Import" restores it — into a new browser, a new machine, or after clearing site data. Clearing your browser data without an export loses the profile permanently.

One exception: to verify the one-page fit, draft LaTeX is sent to an external compile service (`latex.ytotech.com`) to be rendered and counted. Set `LATEX_RENDER_URL` to a self-hosted compiler to keep that on your own infrastructure too; the app degrades to a character-count heuristic if the service is unreachable.

## Tech

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS
- `lib/llm.ts` — provider abstraction over Ollama and the Anthropic SDK
- Schema-constrained JSON for analysis, profile merging, and cut planning
- `pdf-lib` to count real pages of the compiled draft

## Development

```bash
npm run dev          # dev server
npm test             # vitest, unit tests for the pure helpers
npm run test:watch   # vitest in watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run format       # prettier --write .
npm run eval         # model eval harness — needs a live model host
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint and `vitest run` on Node 22 for every push and PR. It does **not** run the eval harness — that needs a live model host and minutes of GPU time.

### Tests

`npm test` covers the pure functions the whole app leans on: the visible-text extraction and one-page budget maths (`lib/latex.ts`), the cut sizing (`lib/render.ts`), the model-output parsers (`lib/llm.ts`), the one-page fitting loop (`lib/trim-loop.ts`, with a mocked page-count check), the rate limiter, and profile export/import.

### Evaluating and comparing models

`npm run eval` scores the analyzer against the fixtures in `evals/fixtures/` and prints a markdown table. Full details in [`evals/README.md`](evals/README.md).

```bash
npm run eval                                    # currently configured backend
npm run eval -- --case cicd-implicit            # one fixture
npm run eval -- --model gpt-oss:20b --json a.json
npm run eval -- --model qwen3:32b   --json b.json
```

### Generation quality (measured)

`npm run eval -- --suite generation` builds a résumé per fixture through the
real pipeline and scores the output. Baseline on `gpt-oss:20b`, 10 fixtures:

| Metric                  | Result                                |
| ----------------------- | ------------------------------------- |
| ATS score               | **100** mean                          |
| One-page                | **10/10**                             |
| `must_include` coverage | **98%**                               |
| Honesty violations      | 1 across 10 cases                     |
| Placeholder leaks       | 0                                     |
| Trim passes             | 1.0 mean (no case needed re-trimming) |
| Time per case           | ~25s                                  |

Two open issues this surfaced, recorded here rather than papered over:

- **The page is often underfilled.** Output averages ~62% of the available
  character budget, ranging from 30% to 91%. The one-page constraint is
  satisfied, but on several cases the model stops well short of a full page
  and leaves real experience unused — the opposite of the failure the trim
  loop was built for. Worth attacking next; the eval now makes it visible.
- **One honesty violation** (`adjacent-not-equal` surfaced "azure data
  services", which the candidate does not have). One breach in ten is one too
  many for a hard constraint, and the suite exits non-zero on it.

`--model` overrides `OLLAMA_MODEL` (or `ANTHROPIC_MODEL`) for a single run, so two models can be compared without editing `.env.local`. Comparing across model _families_ usually also needs `--think off`, because `OLLAMA_THINK` stays set from your env and a non-reasoning model rejects the `think` field with HTTP 400. (`--think off` unsets the variable; it never sends `think: false` — see the gpt-oss warning above.)

The metric that matters is **recall on `present`**. The app turns analyzer-flagged `missing` keywords into hard "never mention this" constraints, so a keyword wrongly filed under `missing` suppresses real experience from your tailored résumé. The `cicd-implicit` fixture exists to catch exactly that: its résumé describes a GitHub Actions build/test/deploy pipeline without ever using the string "CI/CD".

Measured with this harness (10 fixtures, same machine, `OLLAMA_THINK=low` for gpt-oss and `--think off` for Qwen, which does not support thinking):

| Model                         | mean score | `present` P/R | `missing` P/R | honesty violations | mean time/case |
| ----------------------------- | ---------- | ------------- | ------------- | ------------------ | -------------- |
| **`gpt-oss:20b`**             | 68         | 81% / **90%** | 86% / 79%     | 3                  | **8.2s**       |
| Qwen3-Coder-30B-A3B (Q4_K_XL) | 63         | 75% / **58%** | 51% / 60%     | 3                  | 79.8s          |

On the `cicd-implicit` case specifically, `gpt-oss:20b` scored 100% recall on `present` against Qwen3-Coder's 40% — the same distinction the anecdote above describes, now reproducible. Qwen also claimed TypeScript, GraphQL and Redis on a résumé containing none of them.

Model output is not deterministic even at low temperature; expect a few points of movement between runs. Look for consistent, large gaps rather than reading single-run differences.

### Design

The interface is a sheet of stock on a press bed — the materials of typesetting,
because that is what the tool does. Tokens, rules and primitives are documented
in [`docs/design.md`](docs/design.md).

Screenshots are part of the workflow, not a claim:

```bash
node scripts/shoot.mjs http://127.0.0.1:3000 screenshots
```

Captures every route at 390 / 834 / 1440 / 1920 and **exits non-zero on
horizontal overflow or a WCAG AA contrast failure**. The contrast audit found 14
real failures on a redesign that already looked finished, including disabled
buttons at 1.00:1.

### Fine-tuning

Deferred deliberately, with the reasoning and a ready-to-run plan in
[`docs/finetuning.md`](docs/finetuning.md). Briefly: schema adherence is already
guaranteed by grammar-constrained decoding, the base model has not plateaued on
the harness above, and the one measured defect (page fill) is a prompting
problem. The plan is written so it can be executed the moment the evidence
justifies it.

## Limitations

**This is local-first software, and a full tailor run takes minutes.** One run is several sequential model passes — analyze, tailor, compile-and-count, then up to four verify-and-trim cycles, then a final re-analysis — and each pass waits on the one before it. That is fine on your own hardware, where the only cost is wall-clock. It does mean the app will exceed the function timeout on typical hosted platforms (Vercel's serverless functions cap out well below what a single tailor run needs, and the routes already declare `maxDuration` values of 60–300s that most free tiers will not honour). Deploy it on a machine you control — a laptop, a home server, a VPS with a long-lived Node process — rather than a serverless platform. The same applies to the rate limiter, which keeps its counters in process memory and therefore does not coordinate across instances.

## License

MIT — see [LICENSE](LICENSE).
