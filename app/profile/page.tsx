"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  clearProfile,
  loadProfile,
  saveProfile,
  type ParsedProfile,
  type Profile,
} from "@/lib/profile";

type DocKind = "resume" | "cv";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>({});
  const [busy, setBusy] = useState<null | "parse-resume" | "parse-cv">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);

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

  async function parse(kind: DocKind) {
    setError(null);
    const latex =
      kind === "resume" ? profile.baseResumeLatex : profile.baseCvLatex;
    if (!latex?.trim()) {
      setError(
        `Add your ${kind === "resume" ? "base resume" : "base CV"} LaTeX first.`,
      );
      return;
    }
    setBusy(kind === "resume" ? "parse-resume" : "parse-cv");
    try {
      const res = await fetch("/api/profile/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      const updated: Profile = {
        ...profile,
        [kind === "resume" ? "parsedFromResume" : "parsedFromCv"]: data.parsed,
      };
      setProfile(updated);
      saveProfile(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function save() {
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
          Save your base resume, CV, and extra skills here. Resuitme will use
          this as the source of truth when tailoring future applications —
          nothing gets fabricated about what you can do.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      <DocumentBlock
        title="Base resume (LaTeX)"
        description="Your standard, untailored resume. This becomes the starting point when you click 'Use my base resume' on the tailor page."
        value={profile.baseResumeLatex ?? ""}
        onChange={(v) => set("baseResumeLatex", v)}
        onFile={(f) => handleFile("resume", f)}
        onParse={() => parse("resume")}
        parsing={busy === "parse-resume"}
        parsed={profile.parsedFromResume}
      />

      <DocumentBlock
        title="Base CV (LaTeX)"
        description="Optional. A longer comprehensive CV — useful if you want to surface experience that wouldn't fit on a 1-page resume."
        value={profile.baseCvLatex ?? ""}
        onChange={(v) => set("baseCvLatex", v)}
        onFile={(f) => handleFile("cv", f)}
        onParse={() => parse("cv")}
        parsing={busy === "parse-cv"}
        parsed={profile.parsedFromCv}
      />

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-2">Additional skills & notes</h2>
        <p className="text-sm text-white/60 mb-3">
          Anything you have that isn't on your resume or CV. Tools, languages,
          hobby projects, certifications-in-progress. Free form.
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

      <div className="flex flex-wrap items-center gap-3 sticky bottom-4 backdrop-blur bg-black/60 border border-white/10 rounded-lg px-4 py-3">
        <button
          onClick={save}
          className="px-5 py-2 rounded-lg bg-white text-black font-medium text-sm hover:bg-white/90 transition"
        >
          Save profile
        </button>
        {saved && (
          <span className="text-xs text-emerald-300">Saved to this browser.</span>
        )}
        <span className="text-xs text-white/40 ml-auto">
          Profile lives in your browser's localStorage. Clear browser data = profile lost.
        </span>
      </div>
    </main>
  );
}

function DocumentBlock({
  title,
  description,
  value,
  onChange,
  onFile,
  onParse,
  parsing,
  parsed,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onFile: (f: File | null) => void;
  onParse: () => void;
  parsing: boolean;
  parsed?: ParsedProfile;
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
          <button
            onClick={onParse}
            disabled={parsing || !value.trim()}
            className="px-3 py-1.5 rounded-md bg-emerald-500/90 text-black text-xs font-medium hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {parsing ? "Parsing…" : parsed ? "Re-parse with AI" : "Parse with AI"}
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

      {parsed && <ParsedProfileView parsed={parsed} />}
    </section>
  );
}

function ParsedProfileView({ parsed }: { parsed: ParsedProfile }) {
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-5 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {parsed.name && (
            <h3 className="text-2xl font-semibold">{parsed.name}</h3>
          )}
          {parsed.contact && (
            <div className="mt-1 text-sm text-white/70 flex flex-wrap gap-x-4 gap-y-1">
              {parsed.contact.email && <span>{parsed.contact.email}</span>}
              {parsed.contact.phone && <span>{parsed.contact.phone}</span>}
              {parsed.contact.location && (
                <span>{parsed.contact.location}</span>
              )}
              {parsed.contact.links?.map((l, i) => (
                <span key={i} className="text-white/50">
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-emerald-300/80 px-2 py-0.5 rounded-full border border-emerald-500/30">
          Parsed by AI
        </span>
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
                  <div className="font-medium text-white/90">{e.role}</div>
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
                <div className="font-medium text-white/90">{p.name}</div>
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
        <Section title="Skills">
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
