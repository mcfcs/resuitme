"use client";

// Read-only render of the merged profile returned by /api/profile/build.

import type { ParsedProfile } from "@/lib/profile";
import { SourceBadges } from "@/components/profile/SourceBadge";

export default function ParsedProfileView({ parsed }: { parsed: ParsedProfile }) {
  return (
    <div className="space-y-7 rounded-md border border-paper/10 bg-ink-raised/40 p-4 sm:p-6">
      <div>
        {parsed.name && (
          <h3 className="font-display text-2xl font-medium sm:text-3xl">
            {parsed.name}
          </h3>
        )}
        {parsed.contact && (
          <div className="mt-1 text-sm text-paper/70 flex flex-wrap gap-x-4 gap-y-1">
            {parsed.contact.email && <span>{parsed.contact.email}</span>}
            {parsed.contact.phone && <span>{parsed.contact.phone}</span>}
            {parsed.contact.location && <span>{parsed.contact.location}</span>}
            {parsed.contact.links?.map((l, i) => (
              <span key={i} className="text-paper/50">
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      {parsed.summary && (
        <Section title="Summary">
          <p className="text-sm text-paper/80">{parsed.summary}</p>
        </Section>
      )}

      {parsed.experience.length > 0 && (
        <Section title={`Experience (${parsed.experience.length})`}>
          <div className="space-y-3">
            {parsed.experience.map((e, i) => (
              <div
                key={i}
                className="rounded border border-paper/10 bg-paper/[0.02] p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="font-medium text-paper/90">
                    {e.role}
                    <SourceBadges sources={e.sources} />
                  </div>
                  <div className="text-xs text-paper/50">{e.dates}</div>
                </div>
                <div className="text-sm text-paper/70">
                  {e.company}
                  {e.location ? ` · ${e.location}` : ""}
                </div>
                {e.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-paper/75 list-disc list-outside pl-5">
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
                className="rounded border border-paper/10 bg-paper/[0.02] p-3"
              >
                <div className="font-medium text-paper/90">
                  {p.name}
                  <SourceBadges sources={p.sources} />
                </div>
                {p.description && (
                  <div className="text-sm text-paper/70 mt-0.5">
                    {p.description}
                  </div>
                )}
                {p.tech && p.tech.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.tech.map((t, j) => (
                      <span
                        key={j}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-paper/5 border border-paper/10 text-paper/70"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {p.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-paper/75 list-disc list-outside pl-5">
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
                className="rounded border border-paper/10 bg-paper/[0.02] p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="font-medium text-paper/90">
                    {e.institution}
                    <SourceBadges sources={e.sources} />
                  </div>
                  <div className="text-xs text-paper/50">{e.dates}</div>
                </div>
                <div className="text-sm text-paper/70">
                  {[e.degree, e.field].filter(Boolean).join(" · ")}
                </div>
                {e.details && e.details.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-sm text-paper/65 list-disc list-outside pl-5">
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
                  <span className="text-xs uppercase tracking-wide text-paper/50 shrink-0">
                    {c.name}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {c.items.map((s, j) => (
                      <span
                        key={j}
                        className="text-xs px-2 py-0.5 rounded bg-paper/5 border border-paper/10 text-paper/80"
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
                  className="text-xs px-2 py-0.5 rounded bg-paper/5 border border-paper/10 text-paper/80"
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
          <ul className="space-y-1 text-sm text-paper/75">
            {parsed.awards.map((a, i) => (
              <li key={i}>
                <span className="text-paper/90">{a.name}</span>
                {a.year && <span className="text-paper/50"> · {a.year}</span>}
                {a.description && (
                  <span className="text-paper/60"> — {a.description}</span>
                )}
                <SourceBadges sources={a.sources} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {parsed.publications.length > 0 && (
        <Section title="Publications">
          <ul className="space-y-1 text-sm text-paper/75">
            {parsed.publications.map((p, i) => (
              <li key={i}>
                <span className="text-paper/90">{p.title}</span>
                {p.venue && <span className="text-paper/60"> · {p.venue}</span>}
                {p.year && <span className="text-paper/50"> · {p.year}</span>}
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
      <h4 className="font-display text-lg font-medium text-paper/90 mb-3 pb-1.5 border-b border-paper/10">
        {title}
      </h4>
      {children}
    </div>
  );
}
