import { describe, it, expect } from "vitest";
import {
  buildExport,
  exportFilename,
  serializeExport,
  parseImport,
  ProfileImportError,
  EXPORT_FORMAT_VERSION,
} from "@/lib/profile-io";
import type { Profile } from "@/lib/profile";

const SAMPLE: Profile = {
  baseResumeLatex: "\\documentclass{article}\\begin{document}x\\end{document}",
  baseCvLatex: "\\documentclass{article}\\begin{document}cv\\end{document}",
  additionalSkills: "Comfortable with Rust",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

describe("buildExport", () => {
  it("wraps the profile with format metadata", () => {
    const e = buildExport(SAMPLE, new Date("2026-09-10T12:00:00Z"));
    expect(e.format).toBe("resuitme.profile");
    expect(e.version).toBe(EXPORT_FORMAT_VERSION);
    expect(e.exportedAt).toBe("2026-09-10T12:00:00.000Z");
    expect(e.profile).toEqual(SAMPLE);
  });
});

describe("exportFilename", () => {
  it("is dated and .json", () => {
    expect(exportFilename(new Date("2026-09-10T12:00:00Z"))).toBe(
      "resuitme-profile-2026-09-10.json",
    );
  });
});

describe("round trip", () => {
  it("restores an exported profile exactly", () => {
    expect(parseImport(serializeExport(SAMPLE))).toEqual(SAMPLE);
  });

  it("round-trips a parsed profile structure", () => {
    const withParsed: Profile = {
      ...SAMPLE,
      parsed: {
        contact: { name: "Ada" },
        education: [],
        experience: [],
        projects: [],
        skills: { categories: [], flat: ["python"] },
        awards: [],
        publications: [],
      } as unknown as Profile["parsed"],
    };
    const back = parseImport(serializeExport(withParsed));
    expect(back.parsed).toEqual(withParsed.parsed);
  });

  it("round-trips LaTeX with backslashes and unicode intact", () => {
    const tricky: Profile = {
      baseResumeLatex: "\\textbf{Café} \\\\ 40\\% — naïve",
    };
    expect(parseImport(serializeExport(tricky)).baseResumeLatex).toBe(
      tricky.baseResumeLatex,
    );
  });
});

describe("parseImport — accepted shapes", () => {
  it("accepts a bare profile object with no wrapper", () => {
    const p = parseImport(JSON.stringify({ additionalSkills: "Rust" }));
    expect(p.additionalSkills).toBe("Rust");
  });

  it("accepts an export at the current format version", () => {
    const raw = JSON.stringify({
      format: "resuitme.profile",
      version: EXPORT_FORMAT_VERSION,
      exportedAt: "2026-01-01T00:00:00.000Z",
      profile: { additionalSkills: "Go" },
    });
    expect(parseImport(raw).additionalSkills).toBe("Go");
  });

  it("accepts a profile whose only content is the parsed structure", () => {
    const raw = JSON.stringify({ parsed: { skills: { flat: ["sql"] } } });
    expect(parseImport(raw).parsed).toBeDefined();
  });

  it("omits absent optional fields rather than inventing empty strings", () => {
    const p = parseImport(JSON.stringify({ additionalSkills: "Rust" }));
    expect(p.baseResumeLatex).toBeUndefined();
    expect(p.baseCvLatex).toBeUndefined();
  });

  it("ignores unknown top-level fields", () => {
    const raw = JSON.stringify({ additionalSkills: "Rust", bogus: 123 });
    expect(parseImport(raw)).toEqual({
      baseResumeLatex: undefined,
      baseCvLatex: undefined,
      additionalSkills: "Rust",
      updatedAt: undefined,
    });
  });
});

describe("parseImport — rejected input", () => {
  it("rejects malformed JSON", () => {
    expect(() => parseImport("{not json")).toThrow(ProfileImportError);
  });

  it("rejects a JSON array", () => {
    expect(() => parseImport("[1,2,3]")).toThrow(ProfileImportError);
  });

  it("rejects a JSON scalar", () => {
    expect(() => parseImport('"hello"')).toThrow(ProfileImportError);
  });

  it("rejects an empty object as having no content", () => {
    expect(() => parseImport("{}")).toThrow(/no profile content/i);
  });

  it("rejects a profile whose fields are all whitespace", () => {
    expect(() =>
      parseImport(JSON.stringify({ baseResumeLatex: "   " })),
    ).toThrow(/no profile content/i);
  });

  it("rejects a wrong-typed field with a message naming it", () => {
    expect(() => parseImport(JSON.stringify({ baseResumeLatex: 42 }))).toThrow(
      /baseResumeLatex/,
    );
  });

  it("rejects a non-object parsed field", () => {
    expect(() =>
      parseImport(JSON.stringify({ additionalSkills: "x", parsed: "nope" })),
    ).toThrow(/parsed/);
  });

  it("rejects a file from a newer format version", () => {
    const raw = JSON.stringify({
      format: "resuitme.profile",
      version: EXPORT_FORMAT_VERSION + 1,
      profile: { additionalSkills: "Rust" },
    });
    expect(() => parseImport(raw)).toThrow(/newer version/i);
  });

  it("throws ProfileImportError, not a bare Error, for every rejection", () => {
    for (const bad of ["{oops", "[]", "{}", '{"baseCvLatex":5}']) {
      expect(() => parseImport(bad)).toThrow(ProfileImportError);
    }
  });
});
