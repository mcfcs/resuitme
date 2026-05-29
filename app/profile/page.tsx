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

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>({});
  const [busy, setBusy] = useState<null | "build">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const profileViewRef = useRef<HTMLDivElement>(null);

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
      // Smooth-scroll the built profile into view.
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
