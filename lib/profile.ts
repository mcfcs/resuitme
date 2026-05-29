export type ParsedSection<T> = T[];

export type ParsedEducation = {
  institution: string;
  degree?: string;
  field?: string;
  dates?: string;
  location?: string;
  details?: string[];
};

export type ParsedExperience = {
  company: string;
  role: string;
  dates?: string;
  location?: string;
  bullets: string[];
};

export type ParsedProject = {
  name: string;
  description?: string;
  tech?: string[];
  bullets: string[];
};

export type ParsedSkills = {
  categories: Array<{ name: string; items: string[] }>;
  flat: string[];
};

export type ParsedAward = {
  name: string;
  year?: string;
  description?: string;
};

export type ParsedPublication = {
  title: string;
  venue?: string;
  year?: string;
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
  education: ParsedSection<ParsedEducation>;
  experience: ParsedSection<ParsedExperience>;
  projects: ParsedSection<ParsedProject>;
  skills: ParsedSkills;
  awards: ParsedSection<ParsedAward>;
  publications: ParsedSection<ParsedPublication>;
};

export type Profile = {
  baseResumeLatex?: string;
  baseCvLatex?: string;
  additionalSkills?: string;
  parsedFromResume?: ParsedProfile;
  parsedFromCv?: ParsedProfile;
  updatedAt?: string;
};

const STORAGE_KEY = "resuitme.profile.v1";

export function loadProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Profile;
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

export function profileHasAnyData(p: Profile | null): boolean {
  if (!p) return false;
  return Boolean(
    p.baseResumeLatex?.trim() ||
      p.baseCvLatex?.trim() ||
      p.additionalSkills?.trim(),
  );
}
