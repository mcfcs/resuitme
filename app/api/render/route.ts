import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const maxDuration = 120;

// Third-party LaTeX compile service. Defaults to the public YtoTech
// latex-on-http instance (POST JSON, returns a PDF). Override with
// LATEX_RENDER_URL to point at a self-hosted compiler later WITHOUT any code
// change — the contract is the same: POST { compiler, resources:[{main,content}] }.
//
// PRIVACY: this sends the résumé LaTeX to an external service. It runs
// server-side (never from the browser) so the URL/credentials stay private and
// there's a single place to swap the backend. Update the user-facing footer
// copy to disclose this.
const RENDER_URL =
  process.env.LATEX_RENDER_URL || "https://latex.ytotech.com/builds/sync";

const ALLOWED_COMPILERS = ["pdflatex", "xelatex", "lualatex"] as const;
type Compiler = (typeof ALLOWED_COMPILERS)[number];

export type RenderResponse = {
  // The request reached the service AND produced a usable page count.
  ok: boolean;
  // Did the LaTeX compile at all (false → syntax/package error)?
  compiled: boolean;
  // Real page count of the rendered PDF, or null if we couldn't determine it.
  pages: number | null;
  // Which engine compiled it.
  compiler?: Compiler;
  error?: string;
  // Truncated compiler log, surfaced on failure for debugging.
  log?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { latex, compiler } = (await req.json()) as {
      latex?: string;
      compiler?: string;
    };

    if (!latex?.trim()) {
      return NextResponse.json({ error: "Missing latex." }, { status: 400 });
    }

    const chosen: Compiler = ALLOWED_COMPILERS.includes(compiler as Compiler)
      ? (compiler as Compiler)
      : "pdflatex";

    let upstream: Response;
    try {
      upstream = await fetch(RENDER_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/pdf",
        },
        body: JSON.stringify({
          compiler: chosen,
          resources: [{ main: true, content: latex }],
        }),
      });
    } catch (e) {
      // Network/service unreachable — the caller falls back to the char
      // heuristic. Report as a non-compiled result, not a hard 500, so the
      // loop degrades gracefully instead of throwing.
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          ok: false,
          compiled: false,
          pages: null,
          error: `Render service unreachable: ${msg}`,
        } satisfies RenderResponse,
        { status: 200 },
      );
    }

    const ctype = upstream.headers.get("content-type") ?? "";

    // Compile error: the service returns JSON (or text) with logs, not a PDF.
    if (!upstream.ok || !ctype.includes("pdf")) {
      let log = "";
      try {
        const j = (await upstream.json()) as Record<string, unknown>;
        log = String(j.logs ?? j.error ?? JSON.stringify(j)).slice(0, 4000);
      } catch {
        try {
          log = (await upstream.text()).slice(0, 4000);
        } catch {
          log = "";
        }
      }
      return NextResponse.json(
        {
          ok: false,
          compiled: false,
          pages: null,
          compiler: chosen,
          error: "LaTeX failed to compile.",
          log,
        } satisfies RenderResponse,
        { status: 200 },
      );
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());

    let pages: number | null = null;
    try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      pages = pdf.getPageCount();
    } catch {
      // Compiled but we couldn't parse the PDF — leave pages null so the
      // caller falls back rather than trusting a bad number.
      pages = null;
    }

    return NextResponse.json(
      {
        ok: pages !== null,
        compiled: true,
        pages,
        compiler: chosen,
      } satisfies RenderResponse,
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/render]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
