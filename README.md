# Resuitme

Paste your LaTeX resume and a job description. Get a rating, a tailored rewrite, and a download-ready `.tex` file.

Powered by Claude Opus 4.7 (Anthropic).

## Setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Then open http://localhost:3000.

## How it works

1. Paste your LaTeX resume and the target job description.
2. Click **Analyze resume** — Claude scores fit (0–100) and reports strengths, gaps, missing keywords, and suggested edits.
3. Click **Tailor my resume to this job** — Claude rewrites the LaTeX in place (preserving your preamble and packages) and re-rates the result so you can see the lift.
4. Copy the LaTeX or download `resume-tailored.tex`.

Nothing is stored server-side. The resume and JD are sent to Anthropic for inference and returned in the response.

## Tech

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS
- `@anthropic-ai/sdk` — Claude Opus 4.7 with adaptive thinking
- Structured outputs (`output_config.format`) for the analysis JSON
