// Client-safe wrapper around the /api/render route. Keeps the PDF-parsing /
// external-compile machinery server-side; this module only does fetch + types
// so it's safe to import from client components without bundling pdf-lib.

export type PageCheck = {
  // True when we got an authoritative, real page count from a compile.
  measured: boolean;
  // Real page count when measured, else null.
  pages: number | null;
  // Did the LaTeX compile? (false → couldn't measure; caller should fall back.)
  compiled: boolean;
  error?: string;
  log?: string;
};

/**
 * Compile the LaTeX via the server route and return its real page count.
 * Never throws — on any failure it returns { measured:false } so callers can
 * gracefully fall back to the visible-char heuristic.
 */
export async function checkPageCount(
  latex: string,
  compiler?: "pdflatex" | "xelatex" | "lualatex",
): Promise<PageCheck> {
  try {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latex, compiler }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      compiled?: boolean;
      pages?: number | null;
      error?: string;
      log?: string;
    };
    if (!res.ok) {
      return {
        measured: false,
        pages: null,
        compiled: false,
        error: data?.error ?? "Render request failed.",
      };
    }
    const pages = typeof data.pages === "number" ? data.pages : null;
    return {
      measured: !!data.compiled && pages !== null,
      pages,
      compiled: !!data.compiled,
      error: data.error,
      log: data.log,
    };
  } catch (e) {
    return {
      measured: false,
      pages: null,
      compiled: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Given a real page count and the heuristic char overshoot, decide how many
 * visible chars the next trim pass should target removing. When the renderer
 * confirms >1 page but the char heuristic underestimated (overshoot ≤ 0), we
 * still need a positive cut target — floor it at ~12% of budget per extra page.
 */
export function cutTarget(
  pages: number | null,
  heuristicOvershoot: number,
  budget: number,
): number {
  if (pages != null && pages > 1) {
    const perPageFloor = Math.round(budget * 0.12) * (pages - 1);
    return Math.max(heuristicOvershoot, perPageFloor);
  }
  return Math.max(heuristicOvershoot, 0);
}
