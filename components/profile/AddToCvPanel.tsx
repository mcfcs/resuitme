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
    <div className="border border-type-strong/12 bg-stock-shade/40 p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="eyebrow text-type-muted">Add a new</label>
        <select
          value={section}
          onChange={(e) => onSelectSection(e.target.value as PolishKind)}
          className="min-h-[2.75rem] flex-1 border border-type-strong/20 bg-ink px-3 py-1.5 text-sm transition-colors focus-visible:border-marigold focus-visible:outline-none sm:min-h-0 sm:flex-none"
        >
          {(Object.keys(SECTION_LABELS) as PolishKind[]).map((k) => (
            <option key={k} value={k} className="bg-stock">
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
        <div className="mb-3 border border-rust/40 bg-rust/[0.07] px-3 py-2 text-xs text-rust">
          {error}
        </div>
      )}

      {!polished && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onPolish}
            disabled={busy !== null || !canPolish}
            className="w-full bg-marigold px-4 py-2.5 text-sm font-medium text-stock transition hover:bg-marigold-deep disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:py-2"
          >
            {busy === "polish" ? "Polishing…" : "Generate polished version"}
          </button>
          <span className="text-xs text-type-faint">
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
              className="w-full bg-sage-ink px-4 py-2.5 text-sm font-medium text-stock transition hover:bg-sage-ink disabled:opacity-40 sm:w-auto sm:py-2"
            >
              {busy === "insert" ? "Inserting into CV…" : "Add to CV"}
            </button>
            <button
              onClick={onPolish}
              disabled={busy !== null}
              className="flex-1 border border-type-strong/20 px-3 py-2.5 text-xs text-type-strong transition hover:bg-stock-shade/60 disabled:opacity-40 sm:flex-none sm:py-2"
            >
              {busy === "polish" ? "Regenerating…" : "Regenerate"}
            </button>
            <button
              onClick={onDiscardPolish}
              disabled={busy !== null}
              className="flex-1 border border-type-strong/12 px-3 py-2.5 text-xs text-type-muted transition hover:bg-stock-shade/60 disabled:opacity-40 sm:flex-none sm:py-2"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {justAdded && (
        <div className="mt-4 border border-sage-ink/30 bg-sage-ink/10 px-3 py-2 text-xs text-sage-ink">
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
      <div className="eyebrow text-type-muted mb-1.5">
        {config.label}
        {config.required && <span className="text-marigold ml-0.5">*</span>}
      </div>
      {isTextarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={config.placeholder}
          className="w-full text-sm bg-ink border border-type-strong/12 px-3.5 py-2.5 h-28 resize-y focus-visible:outline-none focus-visible:border-marigold focus-visible:ring-1 focus-visible:ring-marigold/40 transition-colors placeholder:text-type-faint"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={config.placeholder}
          className="w-full text-sm bg-ink border border-type-strong/12 px-3.5 py-2.5 focus-visible:outline-none focus-visible:border-marigold focus-visible:ring-1 focus-visible:ring-marigold/40 transition-colors placeholder:text-type-faint"
        />
      )}
      {config.hint && (
        <div className="mt-1 text-[11px] text-type-faint">{config.hint}</div>
      )}
    </label>
  );
}
