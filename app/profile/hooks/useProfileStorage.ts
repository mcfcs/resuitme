"use client";

// localStorage-backed profile state plus the merge call to
// /api/profile/build.
//
// Hydration matters here: the profile only exists in the browser, so the first
// render must NOT read it (server and client markup would disagree). The
// `hydrated` flag gates that — the page renders a placeholder until the effect
// has run.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearProfile,
  loadProfile,
  saveProfile,
  type Profile,
  type Source,
} from "@/lib/profile";
import type { DocKind } from "@/app/profile/types";

/** How long the "Saved to this browser" confirmation stays up. */
const SAVED_FLASH_MS = 1500;

export function useProfileStorage() {
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

  const set = useCallback(
    <K extends keyof Profile>(key: K, value: Profile[K]) => {
      setProfile((p) => ({ ...p, [key]: value }));
    },
    [],
  );

  const flashSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }, []);

  const handleFile = useCallback(
    (kind: DocKind, file: File | null) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        if (kind === "resume") set("baseResumeLatex", text);
        else set("baseCvLatex", text);
      };
      reader.readAsText(file);
    },
    [set],
  );

  const build = useCallback(async () => {
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
      flashSaved();
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
  }, [profile, flashSaved]);

  const saveInputsOnly = useCallback(() => {
    saveProfile(profile);
    flashSaved();
  }, [profile, flashSaved]);

  const reset = useCallback(() => {
    if (!confirm("Clear your saved profile? This cannot be undone.")) return;
    clearProfile();
    setProfile({});
  }, []);

  const hasAnyInput =
    !!profile.baseResumeLatex?.trim() ||
    !!profile.baseCvLatex?.trim() ||
    !!profile.additionalSkills?.trim();

  const builtSources: Source[] = [];
  if (profile.baseResumeLatex?.trim()) builtSources.push("resume");
  if (profile.baseCvLatex?.trim()) builtSources.push("cv");
  if (profile.additionalSkills?.trim()) builtSources.push("notes");

  return {
    profile,
    setProfile,
    set,
    busy,
    error,
    setError,
    saved,
    hydrated,
    profileViewRef,
    handleFile,
    build,
    saveInputsOnly,
    reset,
    hasAnyInput,
    builtSources,
  };
}
