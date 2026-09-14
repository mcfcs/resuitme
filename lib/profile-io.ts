// Export / import the profile as a JSON file.
//
// WHY THIS EXISTS: profile data lives only in localStorage. Clearing site data,
// switching browsers, or getting a new laptop loses everything the user has
// pasted and merged — with no way to get it back. Export is the backup;
// import is the restore.

import type { Profile, ProfileMetric } from "@/lib/profile";

/** Bumped only if the on-disk shape changes incompatibly. */
export const EXPORT_FORMAT_VERSION = 1;

export type ProfileExport = {
  format: "resuitme.profile";
  version: number;
  exportedAt: string;
  profile: Profile;
};

export function buildExport(
  profile: Profile,
  now: Date = new Date(),
): ProfileExport {
  return {
    format: "resuitme.profile",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    profile,
  };
}

/** e.g. resuitme-profile-2026-09-10.json */
export function exportFilename(now: Date = new Date()): string {
  return `resuitme-profile-${now.toISOString().slice(0, 10)}.json`;
}

export function serializeExport(profile: Profile, now?: Date): string {
  return JSON.stringify(buildExport(profile, now), null, 2);
}

export class ProfileImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileImportError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new ProfileImportError(`Field "${field}" must be a string.`);
  }
  return v;
}

/**
 * Validate the confirmed-metrics list. These are the candidate's own
 * assertions and they ground the honesty gates, so a malformed entry is
 * rejected outright rather than passed through: an entry with no claim
 * would ground nothing, and one with a non-string value could not be
 * rendered into the pool.
 */
function parseMetrics(v: unknown): ProfileMetric[] {
  if (!Array.isArray(v)) {
    throw new ProfileImportError(`Field "metrics" must be an array.`);
  }
  return v.map((m, i) => {
    if (!isRecord(m) || typeof m.claim !== "string" || !m.claim.trim()) {
      throw new ProfileImportError(
        `Field "metrics[${i}]" needs a non-empty "claim" string.`,
      );
    }
    const out: ProfileMetric = {
      claim: m.claim,
      addedAt:
        optionalString(m.addedAt, `metrics[${i}].addedAt`) ??
        new Date(0).toISOString(),
    };
    const value = optionalString(m.value, `metrics[${i}].value`);
    if (value !== undefined) out.value = value;
    const anchor = optionalString(m.anchor, `metrics[${i}].anchor`);
    if (anchor !== undefined) out.anchor = anchor;
    return out;
  });
}

/**
 * Parse and validate an exported profile.
 *
 * Deliberately tolerant in two ways, because this file is the user's only
 * backup and a rejected import is worse than a partial one:
 *   - A bare Profile object (no wrapper) is accepted, so hand-edited or
 *     older files still restore.
 *   - `parsed` is passed through without deep validation. It is a large
 *     model-generated structure; the UI already renders it defensively, and
 *     rejecting a whole backup over one unexpected nested field would be the
 *     wrong trade.
 *
 * What IS enforced: the thing must be an object, and the fields the app reads
 * directly must have the right primitive types.
 */
export function parseImport(text: string): Profile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProfileImportError("That file isn't valid JSON.");
  }

  if (!isRecord(raw)) {
    throw new ProfileImportError("Expected a JSON object.");
  }

  // Wrapped export, or a bare profile?
  const candidate =
    raw.format === "resuitme.profile" && isRecord(raw.profile)
      ? raw.profile
      : raw;

  if (
    raw.format === "resuitme.profile" &&
    typeof raw.version === "number" &&
    raw.version > EXPORT_FORMAT_VERSION
  ) {
    throw new ProfileImportError(
      `This file was exported by a newer version of Resuitme (format v${raw.version}). Update the app, then import again.`,
    );
  }

  if (!isRecord(candidate)) {
    throw new ProfileImportError("No profile object found in that file.");
  }

  const profile: Profile = {
    baseResumeLatex: optionalString(
      candidate.baseResumeLatex,
      "baseResumeLatex",
    ),
    baseCvLatex: optionalString(candidate.baseCvLatex, "baseCvLatex"),
    additionalSkills: optionalString(
      candidate.additionalSkills,
      "additionalSkills",
    ),
    updatedAt: optionalString(candidate.updatedAt, "updatedAt"),
  };

  if (candidate.parsed !== undefined && candidate.parsed !== null) {
    if (!isRecord(candidate.parsed)) {
      throw new ProfileImportError(`Field "parsed" must be an object.`);
    }
    profile.parsed = candidate.parsed as Profile["parsed"];
  }

  // The additive optional fields. Each is carried only when present, so an
  // older export restores to exactly what it was.
  const templateId = optionalString(candidate.templateId, "templateId");
  if (templateId !== undefined) profile.templateId = templateId;

  if (candidate.metrics !== undefined && candidate.metrics !== null) {
    profile.metrics = parseMetrics(candidate.metrics);
  }

  const hasAnything =
    profile.baseResumeLatex?.trim() ||
    profile.baseCvLatex?.trim() ||
    profile.additionalSkills?.trim() ||
    profile.parsed;

  if (!hasAnything) {
    throw new ProfileImportError(
      "That file contains no profile content — nothing to import.",
    );
  }

  return profile;
}

/**
 * Trigger a browser download of `content`.
 *
 * The object URL is revoked on a later tick rather than immediately: Safari
 * cancels the download if the URL is revoked in the same task.
 */
export function downloadJson(filename: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
