"use client";

// Read-only render of the merged profile returned by /api/profile/build.

import type { ParsedProfile } from "@/lib/profile";
import { SourceBadges } from "@/components/profile/SourceBadge";

export default function ParsedProfileView({
  parsed,
}: {
  parsed: ParsedProfile;
}) {
  return (
    <div className="space-y-7 border border-type-strong/12 bg-stock-shade/40 p-4 sm:p-6">
      <div>
        {parsed.name && (
          <h3 className="font-display text-2xl font-medium sm:text-3xl">
            {parsed.name}
          </h3>
        )}
        {parsed.contact && (
          <div className="mt-1 text-sm text-type-body flex flex-wrap gap-x-4 gap-y-1">
            {parsed.contact.email && <span>{parsed.contact.email}</span>}
            {parsed.contact.phone && <span>{parsed.contact.phone}</span>}
            {parsed.contact.location && <span>{parsed.contact.location}</span>}
            {parsed.contact.links?.map((l, i) => (
              <span key={i} className="text-type-muted">
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      {parsed.summary && (
        <Section title="Summary">
          <p className="text-sm text-type-strong">{parsed.summary}</p>
        </Section>
      )}

      {parsed.experience.length > 0 && (
        <Section title={`Experience (${parsed.experience.length})`}>
          <div className="space-y-3">
            {parsed.experience.map((e, i) => (
              <div
                key={i}
                className="border border-type-strong/12 bg-stock-shade/35 p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="font-medium text-type-strong">
                    {e.role}
                    <SourceBadges sources={e.sources} />
                  </div>
                  <div className="text-xs text-type-muted">{e.dates}</div>
                </div>
                <div className="text-sm text-type-body">
                  {e.company}
                  {e.location ? ` · ${e.location}` : ""}
                </div>
                {e.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-type-body list-disc list-outside pl-5">
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
                className="border border-type-strong/12 bg-stock-shade/35 p-3"
              >
                <div className="font-medium text-type-strong">
                  {p.name}
                  <SourceBadges sources={p.sources} />
                </div>
                {p.description && (
                  <div className="text-sm text-type-body mt-0.5">
                    {p.description}
                  </div>
                )}
                {p.tech && p.tech.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.tech.map((t, j) => (
                      <span
                        key={j}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-stock-shade/60 border border-type-strong/12 text-type-body"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {p.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-type-body list-disc list-outside pl-5">
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
                className="border border-type-strong/12 bg-stock-shade/35 p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="font-medium text-type-strong">
                    {e.institution}
                    <SourceBadges sources={e.sources} />
                  </div>
                  <div className="text-xs text-type-muted">{e.dates}</div>
                </div>
                <div className="text-sm text-type-body">
                  {[e.degree, e.field].filter(Boolean).join(" · ")}
                </div>
                {e.details && e.details.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-sm text-type-muted list-disc list-outside pl-5">
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
                  <span className="text-xs uppercase tracking-wide text-type-muted shrink-0">
                    {c.name}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {c.items.map((s, j) => (
                      <span
                        key={j}
                        className="text-xs px-2 py-0.5 rounded bg-stock-shade/60 border border-type-strong/12 text-type-strong"
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
                  className="text-xs px-2 py-0.5 rounded bg-stock-shade/60 border border-type-strong/12 text-type-strong"
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
          <ul className="space-y-1 text-sm text-type-body">
            {parsed.awards.map((a, i) => (
              <li key={i}>
                <span className="text-type-strong">{a.name}</span>
                {a.year && <span className="text-type-muted"> · {a.year}</span>}
                {a.description && (
                  <span className="text-type-muted"> — {a.description}</span>
                )}
                <SourceBadges sources={a.sources} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {parsed.publications.length > 0 && (
        <Section title="Publications">
          <ul className="space-y-1 text-sm text-type-body">
            {parsed.publications.map((p, i) => (
              <li key={i}>
                <span className="text-type-strong">{p.title}</span>
                {p.venue && (
                  <span className="text-type-muted"> · {p.venue}</span>
                )}
                {p.year && <span className="text-type-muted"> · {p.year}</span>}
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
      <h4 className="font-display text-lg font-medium text-type-strong mb-3 pb-1.5 border-b border-type-strong/12">
        {title}
      </h4>
      {children}
    </div>
  );
}
