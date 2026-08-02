# Resuitme

Paste your LaTeX resume and a job description. Get a rating, a tailored rewrite, and a download-ready `.tex` file.

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
```

On the machine running Ollama:

```bash
ollama pull gpt-oss:20b

# Remote access: Ollama binds to 127.0.0.1 unless told otherwise.
# Windows: setx OLLAMA_HOST "0.0.0.0"  then restart Ollama
# Linux:   systemctl edit ollama  ->  Environment="OLLAMA_HOST=0.0.0.0"
# ...and allow TCP 11434 through the firewall.
```

### Choosing a model — size it to *usable* VRAM, not nameplate VRAM

The single biggest performance factor is keeping the model **plus its KV cache** inside what the GPU can actually give you. Windows does not fail an oversized allocation; the NVIDIA driver silently spills the overflow into system RAM over PCIe, and Ollama still reports the model as 100% GPU-resident. The only visible symptom is that everything gets several times slower.

Measured on an RTX 5090 Laptop (24 GB nameplate), same model and prompt, varying only the context window:

| Total VRAM in use | Generation speed |
| ----------------- | ---------------- |
| 15.9 GB           | 46 tok/s         |
| 17.2 GB           | 39 tok/s         |
| 17.9 GB           | 18.6 tok/s       |
| 19.4 GB           | 9.2 tok/s        |

So on a 24 GB card, budget roughly **16 GB total** and pick weights around 12–14 GB. Two consequences worth knowing:

- **`gpt-oss:20b` (~13 GB) is the recommended default here.** Mixture-of-experts, so only ~3.6B parameters are active per token, giving large-model instruction-following at small-model speed. Strong at both constrained JSON and long, rule-heavy system prompts, which is exactly this app's workload.
- **Avoid the 30B/32B Q4 builds on a 24 GB card**, tempting as they look. At ~18–19 GB they land squarely in the spill zone and end up *slower than a well-sized smaller model*, not faster.

Alternatives, in order of decreasing footprint:

| Model             | Weights  | Notes                                                       |
| ----------------- | -------- | ----------------------------------------------------------- |
| `gpt-oss:20b`     | ~13 GB   | Recommended. MoE, 128k context, strong structured output.   |
| `qwen3:14b`       | ~9 GB    | Dense, safe headroom, strong general instruction-following. |
| `qwen3:8b`        | ~5 GB    | Fastest; noticeably weaker at the résumé-judgment prompts.  |

If you want more context headroom, halve the KV cache on the Ollama host:

```bash
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
```

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

- **iOS (Safari):** Share → *Add to Home Screen*. Launches fullscreen with no browser chrome, using the marigold-on-ink app icon.
- **Android (Chrome):** menu → *Install app* / *Add to Home screen*.

To use it from your phone against a dev server on your computer, bind the dev server to your LAN:

```bash
npm run dev -- -H 0.0.0.0
# then visit http://<your-computer-ip>:3000 from the phone
```

Note that `navigator.clipboard` is unavailable on plain-HTTP origins in some mobile browsers; the Copy button falls back to a legacy copy path so it still works over LAN.

## How it works

**Tailor mode** (`/`) — paste an existing résumé:

1. Paste your LaTeX résumé and the target job description.
2. **Analyze résumé** — the model scores fit (0–100) and reports strengths, gaps, missing keywords, and suggested edits.
3. **The honesty check** — for every keyword the JD wants but your résumé lacks, mark *I have this* / *Partial* / *I don't*. Anything marked "I don't" is a hard constraint: it will never appear in the output, even implicitly.
4. **Tailor** — the model rewrites the LaTeX in place (preserving your preamble and packages), the draft is compiled to count its real page count, and over-long drafts go through a verify-and-trim loop until they fit one page.
5. Copy the LaTeX, download `.tex`, or open it straight in Overleaf for a PDF preview.

**Build mode** (`/build`) — compose a résumé from scratch out of your saved profile and CV, targeted at one job.

**Profile** (`/profile`) — your source of truth. Paste a base résumé, a longer CV, and free-form skill notes; they get merged into one deduplicated profile. You can also describe a new experience and have it polished into CV-quality prose and inserted into your CV LaTeX, matching the file's existing macros.

Expect a full tailor run to take a few minutes on a local model: it is several sequential model passes, not one.

## Privacy

Résumé and JD text goes to whichever backend you configured — a local Ollama host keeps it on your network; the Anthropic backend does not. Either way, nothing is stored server-side, and profile data lives only in your browser's `localStorage`.

One exception: to verify the one-page fit, draft LaTeX is sent to an external compile service (`latex.ytotech.com`) to be rendered and counted. Set `LATEX_RENDER_URL` to a self-hosted compiler to keep that on your own infrastructure too; the app degrades to a character-count heuristic if the service is unreachable.

## Tech

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS
- `lib/llm.ts` — provider abstraction over Ollama and the Anthropic SDK
- Schema-constrained JSON for analysis, profile merging, and cut planning
- `pdf-lib` to count real pages of the compiled draft
