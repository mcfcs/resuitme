"use client";

import { useState } from "react";
import type { Accent, BudgetInfo } from "@/lib/types";
import type { AtsScanResult } from "@/lib/render";
import type { AtsFinding } from "@/lib/ats/source-lint";
import AtsReport from "@/components/AtsReport";

/**
 * Result panel: the generated LaTeX plus its export actions and one-page
 * verdict. Shared by tailor mode and build mode.
 */
export default function LatexResult({
  title,
  latex,
  filename,
  overleafName,
  budgetInfo,
  accent = "marigold",
  hint,
  ats = null,
  atsFindings = [],
}: {
  title: string;
  latex: string;
  filename: string;
  overleafName: string;
  budgetInfo: BudgetInfo | null;
  accent?: Accent;
  hint: React.ReactNode;
  /** PDF-extraction scan of this résumé; null when unavailable. */
  ats?: AtsScanResult | null;
  /** Static LaTeX lint findings, available without a compile. */
  atsFindings?: AtsFinding[];
}) {
  const [copied, setCopied] = useState(false);

  async function copyLatex() {
    try {
      await navigator.clipboard.writeText(latex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API is unavailable over plain http on some mobile browsers.
      // The textarea fallback keeps "Copy" working on a LAN-hosted instance.
      const ta = document.createElement("textarea");
      ta.value = latex;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  function downloadLatex() {
    const blob = new Blob([latex], { type: "text/x-tex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function openInOverleaf() {
    // Overleaf accepts a form POST to /docs with a 'snip' field containing the source.
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "https://www.overleaf.com/docs";
    form.target = "_blank";
    form.rel = "noopener";
    const snip = document.createElement("textarea");
    snip.name = "snip";
    snip.value = latex;
    form.appendChild(snip);
    const name = document.createElement("input");
    name.type = "hidden";
    name.name = "snip_name";
    name.value = overleafName;
    form.appendChild(name);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  const cta =
    accent === "sage"
      ? "bg-sage-ink hover:bg-sage-ink"
      : "bg-marigold hover:bg-marigold-deep";

  return (
    <section className="mb-12 animate-rise-in md:mb-14">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-medium sm:text-3xl">
            {title}
          </h2>
          {budgetInfo && <BudgetBadge info={budgetInfo} />}
        </div>
        {/* Equal-width grid on mobile so all three stay comfortably tappable. */}
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          <button
            onClick={copyLatex}
            className="min-h-[2.75rem] border border-type-strong/20 px-3 text-xs transition hover:border-type-strong/35 hover:bg-stock-shade/60 sm:min-h-0 sm:py-1.5"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button
            onClick={downloadLatex}
            className="min-h-[2.75rem] border border-type-strong/20 px-3 text-xs transition hover:border-type-strong/35 hover:bg-stock-shade/60 sm:min-h-0 sm:py-1.5"
          >
            Download .tex
          </button>
          <button
            onClick={openInOverleaf}
            className={`min-h-[2.75rem] px-3 text-xs font-semibold text-stock transition sm:min-h-0 sm:py-1.5 ${cta}`}
            title="Opens overleaf.com in a new tab with your LaTeX pre-loaded for an instant PDF preview."
          >
            Overleaf ↗
          </button>
        </div>
      </div>

      <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words border border-type-strong/15 bg-stock-shade/50 p-3 font-mono text-xs leading-relaxed sm:max-h-[600px] sm:p-5">
        {latex}
      </pre>

      <p className="mt-2.5 text-xs text-type-faint">{hint}</p>

      {(ats || atsFindings.length > 0) && (
        <div className="mt-5">
          <AtsReport scan={ats} findings={atsFindings} accent={accent} />
        </div>
      )}

      {budgetInfo &&
        budgetInfo.iterations > 1 &&
        budgetInfo.cutsApplied.length > 0 && (
          <details className="mt-4 border border-type-strong/12 bg-stock-shade/30 p-4 text-sm">
            <summary className="cursor-pointer select-none text-type-body">
              <span className="font-display italic text-type-strong">
                Trimmed to fit one page
              </span>
              <span className="ml-2 text-xs text-type-faint">
                ({budgetInfo.cutsApplied.length}{" "}
                {budgetInfo.cutsApplied.length === 1 ? "cut" : "cuts"} applied)
              </span>
            </summary>
            <ul className="mt-3 list-outside list-disc space-y-1.5 pl-5 text-type-body">
              {budgetInfo.cutsApplied.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </details>
        )}
    </section>
  );
}

export function BudgetBadge({ info }: { info: BudgetInfo }) {
  const pct = info.budget > 0 ? info.resultChars / info.budget : 0;
  const overBy = info.resultChars - info.budget;
  // Real page count is authoritative when present; char budget is the fallback.
  const measured = info.pages !== null;
  const tone = info.fits
    ? "border-sage-ink/40 bg-sage-ink/10 text-sage-ink"
    : "border-rust/50 bg-rust/15 text-rust";
  const icon = info.fits ? "✓" : "⚠";
  const verdict = measured
    ? info.fits
      ? "fits 1 page"
      : `${info.pages} pages`
    : info.fits
      ? "fits 1 page (est.)"
      : `over by ${overBy.toLocaleString()}`;
  return (
    <div
      title={
        (measured
          ? `Compiled PDF: ${info.pages} page${info.pages === 1 ? "" : "s"} (real render — authoritative)\n`
          : `Render unavailable — using visible-char heuristic\n`) +
        `Budget ${info.budget} visible chars (one-page heuristic, 5% safety margin)\n` +
        `Result ${info.resultChars} chars (${Math.round(pct * 100)}% of budget)\n` +
        (info.iterations > 1
          ? `Resolved in ${info.iterations} passes${info.cutsApplied.length ? ` — ${info.cutsApplied.length} cuts applied` : ""}`
          : "Fit on the first pass") +
        (info.fits || measured
          ? ""
          : `\nOVER BY ${overBy} chars — likely overflows to a second page`)
      }
      className={`inline-flex flex-wrap items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs tabular-nums ${tone}`}
    >
      <span className="font-semibold">{icon}</span>
      <span>{verdict}</span>
      {measured ? (
        <>
          <span className="opacity-50">·</span>
          <span className="opacity-70">real render</span>
        </>
      ) : (
        <>
          <span className="opacity-50">·</span>
          <span>
            {info.resultChars.toLocaleString()}
            <span className="opacity-50">/</span>
            {info.budget.toLocaleString()}
          </span>
        </>
      )}
      {info.iterations > 1 && (
        <>
          <span className="opacity-50">·</span>
          <span>{info.iterations} passes</span>
        </>
      )}
    </div>
  );
}
