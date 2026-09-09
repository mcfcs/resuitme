"use client";

// Renders the model's polished entry for review before it is committed to the
// CV. Shapes vary by section kind, so fields are read defensively.

import type { PolishedEntry, PolishKind } from "@/app/profile/types";

export default function PolishedPreview({
  kind,
  data,
}: {
  kind: PolishKind;
  data: { summary: string; polished: PolishedEntry };
}) {
  const p = data.polished as Record<string, unknown>;
  return (
    <div className="rounded-md border border-sage-500/30 bg-sage-500/[0.04] p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="eyebrow text-[10px] px-2 py-0.5 rounded-full border border-sage-500/40 text-sage-300">
          AI-polished preview
        </span>
        <span className="text-xs text-paper/60 italic font-display">
          {data.summary}
        </span>
      </div>

      {kind === "experience" && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <div className="font-medium text-paper/90">
              {String(p.role ?? "")}
            </div>
            <div className="text-xs text-paper/50">{String(p.dates ?? "")}</div>
          </div>
          <div className="text-sm text-paper/70">
            {String(p.company ?? "")}
            {p.location ? ` · ${String(p.location)}` : ""}
          </div>
          {Array.isArray(p.bullets) && (
            <ul className="mt-2 space-y-1 text-sm text-paper/85 list-disc list-outside pl-5">
              {(p.bullets as string[]).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {kind === "project" && (
        <div>
          <div className="font-medium text-paper/90">{String(p.name ?? "")}</div>
          {p.description ? (
            <div className="text-sm text-paper/70 mt-0.5">
              {String(p.description)}
            </div>
          ) : null}
          {Array.isArray(p.tech) && (p.tech as string[]).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(p.tech as string[]).map((t, i) => (
                <span
                  key={i}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-paper/5 border border-paper/10 text-paper/70"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {Array.isArray(p.bullets) && (
            <ul className="mt-2 space-y-1 text-sm text-paper/85 list-disc list-outside pl-5">
              {(p.bullets as string[]).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {kind === "education" && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <div className="font-medium text-paper/90">
              {String(p.institution ?? "")}
            </div>
            <div className="text-xs text-paper/50">{String(p.dates ?? "")}</div>
          </div>
          <div className="text-sm text-paper/70">
            {[p.degree, p.field].filter(Boolean).map(String).join(" · ")}
            {p.location ? ` · ${String(p.location)}` : ""}
          </div>
          {Array.isArray(p.details) && (p.details as string[]).length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm text-paper/75 list-disc list-outside pl-5">
              {(p.details as string[]).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {kind === "award" && (
        <div className="text-sm text-paper/85">
          <span className="font-medium">{String(p.name ?? "")}</span>
          {p.year ? <span className="text-paper/50"> · {String(p.year)}</span> : null}
          {p.description ? (
            <div className="text-paper/70 mt-1">{String(p.description)}</div>
          ) : null}
        </div>
      )}

      {kind === "publication" && (
        <div className="text-sm text-paper/85">
          <span className="font-medium">{String(p.title ?? "")}</span>
          {p.venue ? <span className="text-paper/60"> · {String(p.venue)}</span> : null}
          {p.year ? <span className="text-paper/50"> · {String(p.year)}</span> : null}
        </div>
      )}
    </div>
  );
}
