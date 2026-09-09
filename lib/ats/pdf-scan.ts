// Server-only: pull the text layer out of a compiled PDF so we can score what
// a résumé parser would actually read.
//
// This runs on bytes the render route ALREADY fetched to count pages, so the
// marginal cost is one extraction, not one compile.
//
// Uses unpdf (a serverless-friendly build of PDF.js) rather than pdfjs-dist
// directly: it needs no cmap/standard-font path wiring under the Next bundler
// and exposes the per-item transforms the column detector depends on.

import { scoreExtraction, type AtsScore, type TextItem } from "@/lib/ats/score";

export type PdfScanResult = AtsScore & {
  pages: number;
  /** The extracted text, in stream order — what a parser sees. */
  text: string;
};

/** PDF.js text item, narrowed to the fields used here. */
type RawItem = {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
};

/**
 * Extract and score. Never throws — a scanner outage must degrade to
 * "source lint only", never break a build. Returns null on any failure.
 */
export async function scanPdfBytes(
  bytes: Uint8Array,
  timeoutMs = 15_000,
): Promise<PdfScanResult | null> {
  try {
    return await withTimeout(extract(bytes), timeoutMs);
  } catch {
    return null;
  }
}

async function extract(bytes: Uint8Array): Promise<PdfScanResult> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);

  const items: TextItem[] = [];
  const parts: string[] = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    for (const raw of content.items as RawItem[]) {
      const str = raw.str ?? "";
      parts.push(str);
      if (!str.trim() || !raw.transform) continue;
      items.push({
        str,
        x: raw.transform[4],
        y: raw.transform[5],
        width: raw.width ?? 0,
        height: raw.height ?? 0,
      });
    }
  }

  // Join with spaces so adjacent items do not fuse into phantom words — a
  // parser inserts a separator at item boundaries too.
  const text = parts
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const facts = { text, items, pages: pdf.numPages };
  return { ...scoreExtraction(facts), pages: pdf.numPages, text };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`PDF scan timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
