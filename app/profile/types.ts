// Shared types, field configuration and pure helpers for the profile page.
//
// Extracted verbatim from app/profile/page.tsx. FIELD_CONFIGS drives both the
// adder form and its required-field validation, so the two can never drift.

import type { ParsedProfile, Source } from "@/lib/profile";

export type DocKind = "resume" | "cv";

export type PolishKind =
  | "experience"
  | "project"
  | "education"
  | "award"
  | "publication";

export type Rough = Record<string, string>;
export type PolishedEntry = Record<string, unknown>;

export const SECTION_LABELS: Record<PolishKind, string> = {
  experience: "Experience",
  project: "Project",
  education: "Education",
  award: "Award",
  publication: "Publication",
};

export type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "textarea";
  placeholder?: string;
  required?: boolean;
  hint?: string;
};

export const FIELD_CONFIGS: Record<PolishKind, FieldConfig[]> = {
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

export function emptyRoughFor(kind: PolishKind): Rough {
  const out: Rough = {};
  for (const f of FIELD_CONFIGS[kind]) out[f.name] = "";
  return out;
}

export function hasRequiredFields(kind: PolishKind, rough: Rough): boolean {
  return FIELD_CONFIGS[kind]
    .filter((f) => f.required)
    .every((f) => rough[f.name]?.trim());
}

export function parsedFieldFor(
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

export function appendToParsed(
  parsed: ParsedProfile,
  kind: PolishKind,
  polished: PolishedEntry,
): ParsedProfile {
  const entry = { ...polished, sources: ["cv"] as Source[] };
  const field = parsedFieldFor(kind);
  const arr = parsed[field] as unknown[];
  return { ...parsed, [field]: [...arr, entry] } as ParsedProfile;
}
