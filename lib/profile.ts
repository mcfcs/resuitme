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
