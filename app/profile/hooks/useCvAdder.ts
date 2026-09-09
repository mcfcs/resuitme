"use client";

// The "Add to CV with AI" flow: polish rough input, review, commit.
//
// Two-step on purpose — the model's output is never written to the user's CV
// without an explicit confirm, and editing any field invalidates a pending
// polish so the preview can never be stale relative to the form.

import { useCallback, useState } from "react";
import { saveProfile, type Profile } from "@/lib/profile";
import {
  appendToParsed,
  emptyRoughFor,
  hasRequiredFields,
  SECTION_LABELS,
  type PolishedEntry,
  type PolishKind,
  type Rough,
} from "@/app/profile/types";

/** How long the "added to CV" confirmation stays up. */
const ADDED_FLASH_MS = 4000;

type Args = {
  profile: Profile;
  setProfile: (p: Profile) => void;
};

export function useCvAdder({ profile, setProfile }: Args) {
  const [section, setSection] = useState<PolishKind>("experience");
  const [rough, setRough] = useState<Rough>(emptyRoughFor("experience"));
  const [polished, setPolished] = useState<{
    summary: string;
    polished: PolishedEntry;
  } | null>(null);
  const [busy, setBusy] = useState<null | "polish" | "insert">(null);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const selectSection = useCallback((kind: PolishKind) => {
    setSection(kind);
    setRough(emptyRoughFor(kind));
    setPolished(null);
    setError(null);
  }, []);

  const updateRoughField = useCallback((name: string, value: string) => {
    setRough((r) => ({ ...r, [name]: value }));
    setPolished(null); // polish goes stale on edit
  }, []);

  const polishEntry = useCallback(async () => {
    setError(null);
    if (!hasRequiredFields(section, rough)) {
      setError("Fill the required fields before polishing.");
      return;
    }
    setBusy("polish");
    try {
      const res = await fetch("/api/profile/polish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: section, rough }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Polish failed");
      setPolished({ summary: data.summary, polished: data.polished });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [section, rough]);

  const commitToCv = useCallback(async () => {
    if (!polished) return;
    if (!profile.baseCvLatex?.trim()) {
      setError("No base CV to insert into.");
      return;
    }
    setError(null);
    setBusy("insert");
    try {
      const res = await fetch("/api/profile/insert-cv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cvLatex: profile.baseCvLatex,
          section,
          polished: polished.polished,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Insert failed");

      const updated: Profile = {
        ...profile,
        baseCvLatex: data.updatedCvLatex,
        parsed: profile.parsed
          ? appendToParsed(profile.parsed, section, polished.polished)
          : profile.parsed,
      };
      setProfile(updated);
      saveProfile(updated);
      setJustAdded(`${SECTION_LABELS[section]} added to CV and profile.`);
      setTimeout(() => setJustAdded(null), ADDED_FLASH_MS);

      // Reset adder for the next entry, keep the section selection.
      setRough(emptyRoughFor(section));
      setPolished(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [polished, profile, section, setProfile]);

  const discardPolish = useCallback(() => setPolished(null), []);

  return {
    section,
    rough,
    polished,
    busy,
    error,
    justAdded,
    selectSection,
    updateRoughField,
    polishEntry,
    commitToCv,
    discardPolish,
  };
}
