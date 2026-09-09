"use client";

// The "Add to CV with AI" form: pick a section, fill the rough fields, polish,
// review, commit. Purely presentational — all state lives in useCvAdder().

import {
  FIELD_CONFIGS,
  SECTION_LABELS,
  hasRequiredFields,
  type FieldConfig,
  type PolishedEntry,
  type PolishKind,
  type Rough,
} from "@/app/profile/types";
import PolishedPreview from "@/components/profile/PolishedPreview";

export default function AddToCvPanel({
  section,
  onSelectSection,
  rough,
  onUpdateRough,
  polished,
  busy,
  error,
  justAdded,
  onPolish,
  onCommit,
  onDiscardPolish,
}: {
  section: PolishKind;
  onSelectSection: (k: PolishKind) => void;
  rough: Rough;
  onUpdateRough: (name: string, value: string) => void;
  polished: { summary: string; polished: PolishedEntry } | null;
  busy: null | "polish" | "insert";
  error: string | null;
  justAdded: string | null;
  onPolish: () => void;
  onCommit: () => void;
  onDiscardPolish: () => void;
}) {
  const fields = FIELD_CONFIGS[section];
  const canPolish = hasRequiredFields(section, rough);

  return (
    <div className="rounded-md border border-paper/10 bg-ink-raised/40 p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="eyebrow text-paper/50">Add a new</label>
        <select
          value={section}
          onChange={(e) => onSelectSection(e.target.value as PolishKind)}
          className="min-h-[2.75rem] flex-1 rounded-md border border-paper/15 bg-ink px-3 py-1.5 text-sm transition-colors focus:border-marigold/60 focus:outline-none sm:min-h-0 sm:flex-none"
        >
          {(Object.keys(SECTION_LABELS) as PolishKind[]).map((k) => (
            <option key={k} value={k} className="bg-neutral-900">
              {SECTION_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-4">
        {fields.map((f) => (
          <div
            key={f.name}
            className={f.type === "textarea" ? "md:col-span-2" : ""}
          >
            <Field
              config={f}
              value={rough[f.name] ?? ""}
              onChange={(v) => onUpdateRough(f.name, v)}
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {!polished && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onPolish}
            disabled={busy !== null || !canPolish}
            className="w-full rounded-md bg-marigold px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-marigold-deep disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:py-2"
          >
            {busy === "polish" ? "Polishing…" : "Generate polished version"}
          </button>
          <span className="text-xs text-paper/40">
            The model rewrites your input into CV-quality content. You&apos;ll
            review before anything is added.
          </span>
        </div>
      )}

      {polished && (
        <div className="mt-2 space-y-4">
          <PolishedPreview kind={section} data={polished} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onCommit}
              disabled={busy !== null}
              className="w-full rounded-md bg-sage-500 px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-sage-400 disabled:opacity-40 sm:w-auto sm:py-2"
            >
              {busy === "insert" ? "Inserting into CV…" : "Add to CV"}
            </button>
            <button
              onClick={onPolish}
              disabled={busy !== null}
              className="flex-1 rounded-md border border-paper/15 px-3 py-2.5 text-xs text-paper/80 transition hover:bg-paper/5 disabled:opacity-40 sm:flex-none sm:py-2"
            >
              {busy === "polish" ? "Regenerating…" : "Regenerate"}
            </button>
            <button
              onClick={onDiscardPolish}
              disabled={busy !== null}
              className="flex-1 rounded-md border border-paper/10 px-3 py-2.5 text-xs text-paper/60 transition hover:bg-paper/5 disabled:opacity-40 sm:flex-none sm:py-2"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {justAdded && (
        <div className="mt-4 rounded-md border border-sage-500/30 bg-sage-500/10 px-3 py-2 text-xs text-sage-200">
          {justAdded}
        </div>
      )}
    </div>
  );
}

function Field({
  config,
  value,
  onChange,
}: {
  config: FieldConfig;
  value: string;
  onChange: (v: string) => void;
}) {
  const isTextarea = config.type === "textarea";
  return (
    <label className="block">
      <div className="eyebrow text-paper/50 mb-1.5">
        {config.label}
        {config.required && <span className="text-marigold ml-0.5">*</span>}
      </div>
      {isTextarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={config.placeholder}
          className="w-full text-sm bg-ink border border-paper/10 rounded-md px-3.5 py-2.5 h-28 resize-y focus:outline-none focus:border-marigold/60 focus:ring-1 focus:ring-marigold/30 transition-colors placeholder:text-paper/25"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={config.placeholder}
          className="w-full text-sm bg-ink border border-paper/10 rounded-md px-3.5 py-2.5 focus:outline-none focus:border-marigold/60 focus:ring-1 focus:ring-marigold/30 transition-colors placeholder:text-paper/25"
        />
      )}
      {config.hint && (
        <div className="mt-1 text-[11px] text-paper/40">{config.hint}</div>
      )}
    </label>
  );
}
