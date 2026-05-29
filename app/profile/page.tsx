"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  clearProfile,
  loadProfile,
  saveProfile,
  type ParsedProfile,
  type Profile,
  type Source,
} from "@/lib/profile";

type DocKind = "resume" | "cv";

type PolishKind =
  | "experience"
  | "project"
  | "education"
  | "award"
  | "publication";

type Rough = Record<string, string>;
type PolishedEntry = Record<string, unknown>;

const SECTION_LABELS: Record<PolishKind, string> = {
  experience: "Experience",
  project: "Project",
  education: "Education",
  award: "Award",
  publication: "Publication",
};

type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "textarea";
  placeholder?: string;
  required?: boolean;
  hint?: string;
};

const FIELD_CONFIGS: Record<PolishKind, FieldConfig[]> = {
  experience: [
    { name: "company", label: "Company", placeholder: "Acme Corp", required: true },
    {
      name: "role",
      label: "Role / Title",
      placeholder: "Senior Software Engineer",
      required: true,
    },
    { name: "dates", label: "Dates", placeholder: "Jan 2023 – Present" },
    { name: "location", label: "Location", placeholder: "San Francisco, CA" },
    {
      name: "description",
      label: "What you did",
      type: "textarea",
      placeholder:
        "Describe your role, scope, and accomplishments. The AI will polish into 3–6 CV-style bullets — only using facts you provide here.",
      required: true,
    },
  ],
  project: [
    { name: "name", label: "Project name", placeholder: "Resuitme", required: true },
    {
      name: "tech",
      label: "Tech / tools",
      placeholder: "Next.js, TypeScript, Claude API",
      hint: "Comma-separated.",
    },
    {
      name: "description",
      label: "What it is / what you did",
      type: "textarea",
      placeholder:
        "What does the project do, your role, and any outcomes. The AI will polish into 2–4 bullets.",
      required: true,
    },
  ],
  education: [
    { name: "institution", label: "Institution", placeholder: "MIT", required: true },
    { name: "degree", label: "Degree", placeholder: "B.S." },
    { name: "field", label: "Field", placeholder: "Computer Science" },
    { name: "dates", label: "Dates", placeholder: "2019 – 2023" },
    { name: "location", label: "Location", placeholder: "Cambridge, MA" },
    {
      name: "details",
      label: "Details (optional)",
      type: "textarea",
      placeholder:
        "GPA, honors, relevant coursework, thesis, etc. The AI will format as bullet lines.",
    },
  ],
  award: [
    { name: "name", label: "Award name", placeholder: "Best Paper Award", required: true },
    { name: "year", label: "Year", placeholder: "2024" },
    {
      name: "description",
      label: "Context (optional)",
      type: "textarea",
      placeholder: "Brief context — who awarded it, what it was for.",
    },
  ],
  publication: [
    {
      name: "title",
      label: "Title",
      placeholder: "A Novel Approach to X",
      required: true,
    },
    { name: "venue", label: "Venue", placeholder: "NeurIPS 2024" },
    { name: "year", label: "Year", placeholder: "2024" },
  ],
};

function emptyRoughFor(kind: PolishKind): Rough {
  const out: Rough = {};
  for (const f of FIELD_CONFIGS[kind]) out[f.name] = "";
  return out;
}

function hasRequiredFields(kind: PolishKind, rough: Rough): boolean {
  return FIELD_CONFIGS[kind]
    .filter((f) => f.required)
    .every((f) => rough[f.name]?.trim());
}

function parsedFieldFor(
  kind: PolishKind,
): keyof Pick<
  ParsedProfile,
  "experience" | "projects" | "education" | "awards" | "publications"
> {
  switch (kind) {
    case "experience":
      return "experience";
    case "project":
      return "projects";
    case "education":
      return "education";
    case "award":
      return "awards";
    case "publication":
      return "publications";
  }
}

function appendToParsed(
  parsed: ParsedProfile,
  kind: PolishKind,
  polished: PolishedEntry,
): ParsedProfile {
  const entry = { ...polished, sources: ["cv"] as Source[] };
  const field = parsedFieldFor(kind);
  const arr = parsed[field] as unknown[];
  return { ...parsed, [field]: [...arr, entry] } as ParsedProfile;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>({});
  const [busy, setBusy] = useState<null | "build">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const profileViewRef = useRef<HTMLDivElement>(null);

  // Add-to-CV adder state
  const [adderSection, setAdderSection] = useState<PolishKind>("experience");
  const [adderRough, setAdderRough] = useState<Rough>(emptyRoughFor("experience"));
  const [adderPolished, setAdderPolished] = useState<{
    summary: string;
    polished: PolishedEntry;
  } | null>(null);
  const [adderBusy, setAdderBusy] = useState<null | "polish" | "insert">(null);
  const [adderError, setAdderError] = useState<string | null>(null);
  const [adderJustAdded, setAdderJustAdded] = useState<string | null>(null);

  useEffect(() => {
    const existing = loadProfile();
    if (existing) setProfile(existing);
    setHydrated(true);
  }, []);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  function handleFile(kind: DocKind, file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (kind === "resume") set("baseResumeLatex", text);
      else set("baseCvLatex", text);
    };
    reader.readAsText(file);
  }

  async function build() {
    setError(null);
    if (
      !profile.baseResumeLatex?.trim() &&
      !profile.baseCvLatex?.trim() &&
      !profile.additionalSkills?.trim()
    ) {
      setError("Add at least one input — resume, CV, or skills notes.");
      return;
    }
    setBusy("build");
    try {
      const res = await fetch("/api/profile/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resumeLatex: profile.baseResumeLatex,
          cvLatex: profile.baseCvLatex,
          additionalSkills: profile.additionalSkills,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Profile build failed");
      const updated: Profile = { ...profile, parsed: data.parsed };
      setProfile(updated);
      saveProfile(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      setTimeout(() => {
        profileViewRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function saveInputsOnly() {
    saveProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function reset() {
    if (!confirm("Clear your saved profile? This cannot be undone.")) return;
    clearProfile();
    setProfile({});
  }

  // ----- Add-to-CV handlers -----

  function selectAdderSection(kind: PolishKind) {
    setAdderSection(kind);
    setAdderRough(emptyRoughFor(kind));
    setAdderPolished(null);
    setAdderError(null);
  }

  function updateRoughField(name: string, value: string) {
    setAdderRough((r) => ({ ...r, [name]: value }));
    setAdderPolished(null); // polish goes stale on edit
  }

  async function polishEntry() {
    setAdderError(null);
    if (!hasRequiredFields(adderSection, adderRough)) {
      setAdderError("Fill the required fields before polishing.");
      return;
    }
    setAdderBusy("polish");
    try {
      const res = await fetch("/api/profile/polish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: adderSection,
          rough: adderRough,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Polish failed");
      setAdderPolished({ summary: data.summary, polished: data.polished });
    } catch (e) {
      setAdderError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdderBusy(null);
    }
  }

  async function commitToCv() {
    if (!adderPolished) return;
    if (!profile.baseCvLatex?.trim()) {
      setAdderError("No base CV to insert into.");
      return;
    }
    setAdderError(null);
    setAdderBusy("insert");
    try {
      const res = await fetch("/api/profile/insert-cv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cvLatex: profile.baseCvLatex,
          section: adderSection,
          polished: adderPolished.polished,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Insert failed");

      const updated: Profile = {
        ...profile,
        baseCvLatex: data.updatedCvLatex,
        parsed: profile.parsed
          ? appendToParsed(profile.parsed, adderSection, adderPolished.polished)
          : profile.parsed,
      };
      setProfile(updated);
      saveProfile(updated);
      setAdderJustAdded(
        `${SECTION_LABELS[adderSection]} added to CV and profile.`,
      );
      setTimeout(() => setAdderJustAdded(null), 4000);

      // Reset adder for the next entry, keep the section selection.
      setAdderRough(emptyRoughFor(adderSection));
      setAdderPolished(null);
    } catch (e) {
      setAdderError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdderBusy(null);
    }
  }

  function discardAdderPolish() {
    setAdderPolished(null);
  }

  if (!hydrated) {
    return (
      <main className="min-h-screen px-6 py-10 max-w-5xl mx-auto">
        <div className="text-white/40 text-sm">Loading…</div>
      </main>
    );
  }

  const hasAnyInput =
    !!profile.baseResumeLatex?.trim() ||
    !!profile.baseCvLatex?.trim() ||
    !!profile.additionalSkills?.trim();

  const builtSources: Source[] = [];
  if (profile.baseResumeLatex?.trim()) builtSources.push("resume");
  if (profile.baseCvLatex?.trim()) builtSources.push("cv");
  if (profile.additionalSkills?.trim()) builtSources.push("notes");

  return (
    <main className="min-h-screen px-6 py-10 md:py-16 max-w-5xl mx-auto">
      <nav className="mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-white/60 hover:text-white transition"
        >
          ← Back to tailor
        </Link>
        <div className="flex items-center gap-3">
          {profile.updatedAt && (
            <span className="text-xs text-white/40">
              Last saved {new Date(profile.updatedAt).toLocaleString()}
            </span>
          )}
          <button
            onClick={reset}
            className="text-xs text-white/50 hover:text-red-300 transition"
          >
            Clear profile
          </button>
        </div>
      </nav>

      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">Your profile</h1>
        <p className="mt-2 text-white/60 max-w-2xl">
          Paste your base resume, base CV, and any extra skills. Resuitme merges
          them into one unified profile — deduplicating shared entries and
          combining bullets where the resume and CV overlap.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      <DocumentBlock
        title="Base resume (LaTeX)"
        description="Your standard, untailored resume. Becomes the starting point when you click 'Use my base resume' on the tailor page."
        value={profile.baseResumeLatex ?? ""}
        onChange={(v) => set("baseResumeLatex", v)}
        onFile={(f) => handleFile("resume", f)}
      />

      <DocumentBlock
        title="Base CV (LaTeX)"
        description="Optional. A longer comprehensive CV — anything that didn't fit on the resume. Merged into the same profile."
        value={profile.baseCvLatex ?? ""}
        onChange={(v) => set("baseCvLatex", v)}
        onFile={(f) => handleFile("cv", f)}
      />

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-2">Additional skills & notes</h2>
        <p className="text-sm text-white/60 mb-3">
          Anything you have that isn&apos;t on your resume or CV. Tools,
          languages, projects, in-progress certifications. Free form. Merged in
          and tagged as &quot;notes&quot;.
        </p>
        <textarea
          value={profile.additionalSkills ?? ""}
          onChange={(e) => set("additionalSkills", e.target.value)}
          placeholder={`e.g.
- Comfortable with Rust (used in personal projects, not on resume)
- AWS Solutions Architect Associate (studying for the exam, no cert yet)
- Currently learning Kubernetes
- Conversational Spanish`}
          className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 h-40 resize-y focus:outline-none focus:border-white/30"
        />
      </section>

      {/* AI-assisted CV addition */}
      <section className="mb-10">
        <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
          <div>
            <h2 className="text-xl font-semibold">Add to CV with AI</h2>
            <p className="text-sm text-white/60 mt-1 max-w-2xl">
              Describe a new experience, project, or other entry. Claude polishes
              your input into clean CV-quality content, you review, and on
              confirm it&apos;s inserted into your base CV LaTeX. Your resume
              stays untouched — the CV is the full source of truth.
            </p>
          </div>
        </div>

        {!profile.baseCvLatex?.trim() ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-white/60">
            Paste a base CV above first — this feature inserts entries into your
            existing CV LaTeX, matching its formatting and macros.
          </div>
        ) : (
          <AddToCvPanel
            section={adderSection}
            onSelectSection={selectAdderSection}
            rough={adderRough}
            onUpdateRough={updateRoughField}
            polished={adderPolished}
            busy={adderBusy}
            error={adderError}
            justAdded={adderJustAdded}
            onPolish={polishEntry}
            onCommit={commitToCv}
            onDiscardPolish={discardAdderPolish}
          />
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 sticky bottom-4 backdrop-blur bg-black/70 border border-white/10 rounded-lg px-4 py-3 z-10">
        <button
          onClick={build}
          disabled={busy !== null || !hasAnyInput}
          className="px-5 py-2 rounded-lg bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {busy === "build"
            ? "Merging…"
            : profile.parsed
              ? "Rebuild profile"
              : "Build profile"}
        </button>
        <button
          onClick={saveInputsOnly}
          disabled={busy !== null}
          className="px-4 py-2 rounded-lg border border-white/15 text-sm text-white/80 hover:bg-white/5 disabled:opacity-40 transition"
        >
          Save inputs only
        </button>
        {saved && (
          <span className="text-xs text-emerald-300">Saved to this browser.</span>
        )}
        <span className="text-xs text-white/40 ml-auto hidden md:block">
          Profile lives in your browser&apos;s localStorage.
        </span>
      </div>

      <div ref={profileViewRef} />

      {profile.parsed && (
        <section className="mt-12">
          <div className="flex items-baseline justify-between flex-wrap gap-3 mb-4">
            <h2 className="text-2xl font-semibold">Merged profile</h2>
            <div className="flex items-center gap-2 text-xs text-white/60">
              <span>Built from:</span>
              {builtSources.map((s) => (
                <SourceBadge key={s} source={s} />
              ))}
            </div>
          </div>
          <ParsedProfileView parsed={profile.parsed} />
        </section>
      )}
    </main>
  );
}

function DocumentBlock({
  title,
  description,
  value,
  onChange,
  onFile,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onFile: (f: File | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section className="mb-10">
      <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm text-white/60 mt-1 max-w-2xl">{description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <input
            ref={fileRef}
            type="file"
            accept=".tex,text/plain,text/x-tex"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 rounded-md border border-white/15 text-xs hover:bg-white/5 transition"
          >
            Upload .tex
          </button>
        </div>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste LaTeX source or upload a .tex file…"
        className="w-full font-mono text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 h-64 resize-y focus:outline-none focus:border-white/30"
      />
      <div className="text-xs text-white/40 mt-1">
        {value.length.toLocaleString()} chars
      </div>
    </section>
  );
}

function AddToCvPanel({
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
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <label className="text-xs uppercase tracking-wide text-white/50">
          Add a new
        </label>
        <select
          value={section}
          onChange={(e) => onSelectSection(e.target.value as PolishKind)}
          className="text-sm bg-white/5 border border-white/15 rounded-md px-2 py-1.5 focus:outline-none focus:border-white/30"
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
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={onPolish}
            disabled={busy !== null || !canPolish}
            className="px-4 py-2 rounded-md bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {busy === "polish" ? "Polishing…" : "Generate polished version"}
          </button>
          <span className="text-xs text-white/40">
            Claude rewrites your input into CV-quality content. You&apos;ll
            review before anything is added.
          </span>
        </div>
      )}

      {polished && (
        <div className="mt-2 space-y-4">
          <PolishedPreview kind={section} data={polished} />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onCommit}
              disabled={busy !== null}
              className="px-4 py-2 rounded-md bg-emerald-500 text-black text-sm font-medium hover:bg-emerald-400 disabled:opacity-40 transition"
            >
              {busy === "insert"
                ? "Inserting into CV…"
                : "Add to CV"}
            </button>
            <button
              onClick={onPolish}
              disabled={busy !== null}
              className="px-3 py-2 rounded-md border border-white/15 text-xs text-white/80 hover:bg-white/5 disabled:opacity-40 transition"
            >
              {busy === "polish" ? "Regenerating…" : "Regenerate"}
            </button>
            <button
              onClick={onDiscardPolish}
              disabled={busy !== null}
              className="px-3 py-2 rounded-md border border-white/10 text-xs text-white/60 hover:bg-white/5 disabled:opacity-40 transition"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {justAdded && (
        <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
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
      <div className="text-xs uppercase tracking-wide text-white/50 mb-1">
        {config.label}
        {config.required && <span className="text-red-300 ml-0.5">*</span>}
      </div>
      {isTextarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={config.placeholder}
          className="w-full text-sm bg-white/5 border border-white/10 rounded-md px-3 py-2 h-28 resize-y focus:outline-none focus:border-white/30"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={config.placeholder}
          className="w-full text-sm bg-white/5 border border-white/10 rounded-md px-3 py-2 focus:outline-none focus:border-white/30"
        />
      )}
      {config.hint && (
        <div className="mt-1 text-[11px] text-white/40">{config.hint}</div>
      )}
    </label>
  );
}

function PolishedPreview({
  kind,
  data,
}: {
  kind: PolishKind;
  data: { summary: string; polished: PolishedEntry };
}) {
  const p = data.polished as Record<string, unknown>;
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300">
          AI-polished preview
        </span>
        <span className="text-xs text-white/60">{data.summary}</span>
      </div>

      {kind === "experience" && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <div className="font-medium text-white/90">
              {String(p.role ?? "")}
            </div>
            <div className="text-xs text-white/50">{String(p.dates ?? "")}</div>
          </div>
          <div className="text-sm text-white/70">
            {String(p.company ?? "")}
            {p.location ? ` · ${String(p.location)}` : ""}
          </div>
          {Array.isArray(p.bullets) && (
            <ul className="mt-2 space-y-1 text-sm text-white/85 list-disc list-outside pl-5">
              {(p.bullets as string[]).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {kind === "project" && (
        <div>
          <div className="font-medium text-white/90">{String(p.name ?? "")}</div>
          {p.description ? (
            <div className="text-sm text-white/70 mt-0.5">
              {String(p.description)}
            </div>
          ) : null}
          {Array.isArray(p.tech) && (p.tech as string[]).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(p.tech as string[]).map((t, i) => (
                <span
                  key={i}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/70"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {Array.isArray(p.bullets) && (
            <ul className="mt-2 space-y-1 text-sm text-white/85 list-disc list-outside pl-5">
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
            <div className="font-medium text-white/90">
              {String(p.institution ?? "")}
            </div>
            <div className="text-xs text-white/50">{String(p.dates ?? "")}</div>
          </div>
          <div className="text-sm text-white/70">
            {[p.degree, p.field].filter(Boolean).map(String).join(" · ")}
            {p.location ? ` · ${String(p.location)}` : ""}
          </div>
          {Array.isArray(p.details) && (p.details as string[]).length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm text-white/75 list-disc list-outside pl-5">
              {(p.details as string[]).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {kind === "award" && (
        <div className="text-sm text-white/85">
          <span className="font-medium">{String(p.name ?? "")}</span>
          {p.year ? <span className="text-white/50"> · {String(p.year)}</span> : null}
          {p.description ? (
            <div className="text-white/70 mt-1">{String(p.description)}</div>
          ) : null}
        </div>
      )}

      {kind === "publication" && (
        <div className="text-sm text-white/85">
          <span className="font-medium">{String(p.title ?? "")}</span>
          {p.venue ? <span className="text-white/60"> · {String(p.venue)}</span> : null}
          {p.year ? <span className="text-white/50"> · {String(p.year)}</span> : null}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: Source }) {
  const style: Record<Source, string> = {
    resume: "bg-sky-500/15 text-sky-200 border-sky-500/30",
    cv: "bg-purple-500/15 text-purple-200 border-purple-500/30",
    notes: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  };
  const label: Record<Source, string> = {
    resume: "resume",
    cv: "cv",
    notes: "notes",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-[1px] rounded-md text-[10px] uppercase tracking-wider border ${style[source]}`}
    >
      {label[source]}
    </span>
  );
}

function SourceBadges({ sources }: { sources: Source[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="inline-flex items-center gap-1 ml-2 align-middle">
      {sources.map((s) => (
        <SourceBadge key={s} source={s} />
      ))}
    </div>
  );
}

function ParsedProfileView({ parsed }: { parsed: ParsedProfile }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5 space-y-6">
      <div>
        {parsed.name && (
          <h3 className="text-2xl font-semibold">{parsed.name}</h3>
        )}
        {parsed.contact && (
          <div className="mt-1 text-sm text-white/70 flex flex-wrap gap-x-4 gap-y-1">
            {parsed.contact.email && <span>{parsed.contact.email}</span>}
            {parsed.contact.phone && <span>{parsed.contact.phone}</span>}
            {parsed.contact.location && <span>{parsed.contact.location}</span>}
            {parsed.contact.links?.map((l, i) => (
              <span key={i} className="text-white/50">
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      {parsed.summary && (
        <Section title="Summary">
          <p className="text-sm text-white/80">{parsed.summary}</p>
        </Section>
      )}

      {parsed.experience.length > 0 && (
        <Section title={`Experience (${parsed.experience.length})`}>
          <div className="space-y-3">
            {parsed.experience.map((e, i) => (
              <div
                key={i}
                className="rounded border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="font-medium text-white/90">
                    {e.role}
                    <SourceBadges sources={e.sources} />
                  </div>
                  <div className="text-xs text-white/50">{e.dates}</div>
                </div>
                <div className="text-sm text-white/70">
                  {e.company}
                  {e.location ? ` · ${e.location}` : ""}
                </div>
                {e.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-white/75 list-disc list-outside pl-5">
                    {e.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {parsed.projects.length > 0 && (
        <Section title={`Projects (${parsed.projects.length})`}>
          <div className="space-y-3">
            {parsed.projects.map((p, i) => (
              <div
                key={i}
                className="rounded border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="font-medium text-white/90">
                  {p.name}
                  <SourceBadges sources={p.sources} />
                </div>
                {p.description && (
                  <div className="text-sm text-white/70 mt-0.5">
                    {p.description}
                  </div>
                )}
                {p.tech && p.tech.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.tech.map((t, j) => (
                      <span
                        key={j}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/70"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {p.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-white/75 list-disc list-outside pl-5">
                    {p.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {parsed.education.length > 0 && (
        <Section title={`Education (${parsed.education.length})`}>
          <div className="space-y-3">
            {parsed.education.map((e, i) => (
              <div
                key={i}
                className="rounded border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="font-medium text-white/90">
                    {e.institution}
                    <SourceBadges sources={e.sources} />
                  </div>
                  <div className="text-xs text-white/50">{e.dates}</div>
                </div>
                <div className="text-sm text-white/70">
                  {[e.degree, e.field].filter(Boolean).join(" · ")}
                </div>
                {e.details && e.details.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-sm text-white/65 list-disc list-outside pl-5">
                    {e.details.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {parsed.skills.flat.length > 0 && (
        <Section title={`Skills (${parsed.skills.flat.length})`}>
          {parsed.skills.categories.length > 0 ? (
            <div className="space-y-2">
              {parsed.skills.categories.map((c, i) => (
                <div key={i} className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs uppercase tracking-wide text-white/50 shrink-0">
                    {c.name}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {c.items.map((s, j) => (
                      <span
                        key={j}
                        className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/80"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {parsed.skills.flat.map((s, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/80"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </Section>
      )}

      {parsed.awards.length > 0 && (
        <Section title="Awards">
          <ul className="space-y-1 text-sm text-white/75">
            {parsed.awards.map((a, i) => (
              <li key={i}>
                <span className="text-white/90">{a.name}</span>
                {a.year && <span className="text-white/50"> · {a.year}</span>}
                {a.description && (
                  <span className="text-white/60"> — {a.description}</span>
                )}
                <SourceBadges sources={a.sources} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {parsed.publications.length > 0 && (
        <Section title="Publications">
          <ul className="space-y-1 text-sm text-white/75">
            {parsed.publications.map((p, i) => (
              <li key={i}>
                <span className="text-white/90">{p.title}</span>
                {p.venue && <span className="text-white/60"> · {p.venue}</span>}
                {p.year && <span className="text-white/50"> · {p.year}</span>}
                <SourceBadges sources={p.sources} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-white/80 mb-2">{title}</h4>
      {children}
    </div>
  );
}
