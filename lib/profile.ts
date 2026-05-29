export type Source = "resume" | "cv" | "notes";

export type ParsedEducation = {
  institution: string;
  degree?: string;
  field?: string;
  dates?: string;
  location?: string;
  details?: string[];
  sources: Source[];
};

export type ParsedExperience = {
  company: string;
  role: string;
  dates?: string;
  location?: string;
  bullets: string[];
  sources: Source[];
};

export type ParsedProject = {
  name: string;
  description?: string;
  tech?: string[];
  bullets: string[];
  sources: Source[];
};

export type ParsedSkills = {
  categories: Array<{ name: string; items: string[] }>;
  flat: string[];
};

export type ParsedAward = {
  name: string;
  year?: string;
  description?: string;
  sources: Source[];
};

export type ParsedPublication = {
  title: string;
  venue?: string;
  year?: string;
  sources: Source[];
};

export type ParsedProfile = {
  name?: string;
  contact?: {
    email?: string;
    phone?: string;
    location?: string;
    links?: string[];
  };
  summary?: string;
  education: ParsedEducation[];
  experience: ParsedExperience[];
  projects: ParsedProject[];
  skills: ParsedSkills;
  awards: ParsedAward[];
  publications: ParsedPublication[];
};

export type Profile = {
  baseResumeLatex?: string;
  baseCvLatex?: string;
  additionalSkills?: string;
  parsed?: ParsedProfile;
  updatedAt?: string;
};

const STORAGE_KEY = "resuitme.profile.v2";
const STORAGE_KEY_V1 = "resuitme.profile.v1";

export function loadProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Profile;
    // Migrate from v1: keep raw inputs, drop the split parsed fields.
    const v1Raw = localStorage.getItem(STORAGE_KEY_V1);
    if (v1Raw) {
      const v1 = JSON.parse(v1Raw) as {
        baseResumeLatex?: string;
        baseCvLatex?: string;
        additionalSkills?: string;
        updatedAt?: string;
      };
      const migrated: Profile = {
        baseResumeLatex: v1.baseResumeLatex,
        baseCvLatex: v1.baseCvLatex,
        additionalSkills: v1.additionalSkills,
        updatedAt: v1.updatedAt,
      };
      saveProfile(migrated);
      localStorage.removeItem(STORAGE_KEY_V1);
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile): void {
  if (typeof window === "undefined") return;
  const next = { ...profile, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function clearProfile(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function profileHasAnyInput(p: Profile | null): boolean {
  if (!p) return false;
  return Boolean(
    p.baseResumeLatex?.trim() ||
      p.baseCvLatex?.trim() ||
      p.additionalSkills?.trim(),
  );
}

/**
 * Flatten a ParsedProfile into a plain-text summary suitable for analysis or
 * for feeding into a model as "the candidate's content". Not pretty — just
 * comprehensive and parseable.
 */
export function profileToText(p: ParsedProfile): string {
  const sections: string[] = [];

  if (p.name) sections.push(`Name: ${p.name}`);

  if (p.contact) {
    const bits = [
      p.contact.email,
      p.contact.phone,
      p.contact.location,
      ...(p.contact.links ?? []),
    ].filter(Boolean);
    if (bits.length) sections.push(`Contact: ${bits.join(" | ")}`);
  }

  if (p.summary) sections.push(`Summary:\n${p.summary}`);

  if (p.education?.length) {
    sections.push(
      "Education:\n" +
        p.education
          .map((e) => {
            const header = [
              e.institution,
              [e.degree, e.field].filter(Boolean).join(" in "),
              e.dates,
              e.location,
            ]
              .filter(Boolean)
              .join(" — ");
            const details = (e.details ?? []).length
              ? "\n  • " + e.details!.join("\n  • ")
              : "";
            return `- ${header}${details}`;
          })
          .join("\n"),
    );
  }

  if (p.experience?.length) {
    sections.push(
      "Experience:\n" +
        p.experience
          .map((e) => {
            const header = [
              e.role,
              `at ${e.company}`,
              e.dates,
              e.location,
            ]
              .filter(Boolean)
              .join(" — ");
            const bullets = e.bullets.length
              ? "\n  • " + e.bullets.join("\n  • ")
              : "";
            return `- ${header}${bullets}`;
          })
          .join("\n\n"),
    );
  }

  if (p.projects?.length) {
    sections.push(
      "Projects:\n" +
        p.projects
          .map((pr) => {
            const head = pr.tech?.length
              ? `${pr.name} [${pr.tech.join(", ")}]`
              : pr.name;
            const desc = pr.description ? `\n  ${pr.description}` : "";
            const bullets = pr.bullets?.length
              ? "\n  • " + pr.bullets.join("\n  • ")
              : "";
            return `- ${head}${desc}${bullets}`;
          })
          .join("\n\n"),
    );
  }

  if (p.skills?.flat?.length) {
    const cats = p.skills.categories
      ?.map((c) => `${c.name}: ${c.items.join(", ")}`)
      .join("\n  ");
    sections.push(
      "Skills:\n  " + (cats?.length ? cats : p.skills.flat.join(", ")),
    );
  }

  if (p.awards?.length) {
    sections.push(
      "Awards:\n" +
        p.awards
          .map(
            (a) =>
              `- ${a.name}${a.year ? ` (${a.year})` : ""}${a.description ? ` — ${a.description}` : ""}`,
          )
          .join("\n"),
    );
  }

  if (p.publications?.length) {
    sections.push(
      "Publications:\n" +
        p.publications
          .map(
            (pp) =>
              `- ${pp.title}${pp.venue ? ` — ${pp.venue}` : ""}${pp.year ? ` (${pp.year})` : ""}`,
          )
          .join("\n"),
    );
  }

  return sections.join("\n\n");
}
