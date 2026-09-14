import { describe, it, expect } from "vitest";
import { metricsToText, type Profile, type ProfileMetric } from "@/lib/profile";
import {
  parseImport,
  serializeExport,
  ProfileImportError,
} from "@/lib/profile-io";

const METRICS: ProfileMetric[] = [
  {
    claim: "Boosted inventory turnover",
    value: "15%",
    anchor: "Developed demand-based dynamic pricing strategies",
    addedAt: "2026-09-15T00:00:00.000Z",
  },
  {
    claim: "Led the pricing work",
    addedAt: "2026-09-15T00:00:00.000Z",
  },
];

describe("metricsToText", () => {
  it("renders a figure next to its claim and anchor", () => {
    expect(metricsToText([METRICS[0]])).toBe(
      "- Boosted inventory turnover: 15% (Developed demand-based dynamic pricing strategies)",
    );
  });

  it("renders a confirmed claim with no figure", () => {
    expect(metricsToText([METRICS[1]])).toBe("- Led the pricing work");
  });

  it("returns nothing for an absent or empty list", () => {
    expect(metricsToText(undefined)).toBe("");
    expect(metricsToText([])).toBe("");
  });

  it("skips an entry with a blank claim", () => {
    expect(
      metricsToText([{ claim: "  ", value: "9", addedAt: "" }, METRICS[1]]),
    ).toBe("- Led the pricing work");
  });
});

describe("profile export/import — additive fields", () => {
  const profile: Profile = {
    baseCvLatex: "\\documentclass{article}\\begin{document}cv\\end{document}",
    templateId: "compact",
    metrics: METRICS,
    updatedAt: "2026-09-15T00:00:00.000Z",
  };

  it("round-trips metrics and the layout choice", () => {
    expect(parseImport(serializeExport(profile))).toEqual(profile);
  });

  it("loads an older export with neither field, unchanged", () => {
    const older: Profile = {
      baseCvLatex: profile.baseCvLatex,
      updatedAt: profile.updatedAt,
    };
    const back = parseImport(serializeExport(older));
    expect(back).toEqual(older);
    expect("metrics" in back).toBe(false);
    expect("templateId" in back).toBe(false);
  });

  it("rejects a metrics field that is not an array", () => {
    expect(() =>
      parseImport(JSON.stringify({ ...profile, metrics: { claim: "x" } })),
    ).toThrow(ProfileImportError);
  });

  it("rejects a metric with no claim, naming the entry", () => {
    expect(() =>
      parseImport(JSON.stringify({ ...profile, metrics: [{ value: "15%" }] })),
    ).toThrow(/metrics\[0\]/);
  });

  it("rejects a metric whose value is not a string", () => {
    expect(() =>
      parseImport(
        JSON.stringify({ ...profile, metrics: [{ claim: "x", value: 15 }] }),
      ),
    ).toThrow(ProfileImportError);
  });

  it("fills a missing addedAt rather than rejecting a hand-edited file", () => {
    const back = parseImport(
      JSON.stringify({ ...profile, metrics: [{ claim: "x" }] }),
    );
    expect(back.metrics?.[0].claim).toBe("x");
    expect(typeof back.metrics?.[0].addedAt).toBe("string");
  });
});
