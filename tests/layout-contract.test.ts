import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  layoutContractBlock,
  protectedSectionsBlock,
} from "@/lib/prompts/layout-contract";
import { TEMPLATES, getTemplate, type BuiltinTemplate } from "@/lib/templates";

const classic = getTemplate("classic");

describe("layoutContractBlock", () => {
  const block = layoutContractBlock(classic);

  it("states the section order in order", () => {
    expect(block).toContain(
      "Section order: Summary → Education → Skills → Experience → Projects",
    );
  });

  it("names the mandatory sections", () => {
    expect(block).toMatch(/Mandatory sections[^\n]*Summary, Education/);
  });

  it("names the optional sections", () => {
    expect(block).toMatch(
      /Optional sections[^\n]*Skills, Experience, Projects/,
    );
  });

  it("shows each macro with its call shape", () => {
    expect(block).toContain(
      "\\resumeSubheading{organization}{dates}{role}{location}",
    );
    expect(block).toContain("\\resumeItem{bullet text}");
  });

  it("lists every placeholder string", () => {
    for (const p of classic.placeholders) {
      expect(block).toContain(`"${p}"`);
    }
  });

  it("forbids inventing sections and reordering", () => {
    expect(block).toMatch(/Do not add, rename, split or reorder sections/);
    expect(block).toMatch(/never to the section sequence/);
  });

  it("omits the optional-sections line when there are none", () => {
    const t: BuiltinTemplate = { ...classic, optionalSections: [] };
    expect(layoutContractBlock(t)).not.toContain("Optional sections");
  });

  it("omits the macro list when a layout declares none", () => {
    const t: BuiltinTemplate = { ...classic, macros: [] };
    expect(layoutContractBlock(t)).not.toContain("Layout macros");
  });

  it("renders a zero-argument macro without empty braces", () => {
    const t: BuiltinTemplate = {
      ...classic,
      macros: [{ name: "sectionRule", args: [], purpose: "A rule." }],
    };
    expect(layoutContractBlock(t)).toContain("\\sectionRule — A rule.");
    expect(layoutContractBlock(t)).not.toContain("\\sectionRule{}");
  });

  it("reflects a different section order rather than hardcoding one", () => {
    // The whole point of the metadata: an academic layout leads with
    // Education and surfaces Publications.
    const t: BuiltinTemplate = {
      ...classic,
      sectionOrder: ["Education", "Publications", "Experience"],
      requiredSections: ["Education"],
      optionalSections: ["Publications", "Experience"],
    };
    const b = layoutContractBlock(t);
    expect(b).toContain("Education → Publications → Experience");
    expect(b).not.toContain("Summary →");
  });
});

describe("protectedSectionsBlock", () => {
  it("names the sections the trim planner may never cut", () => {
    expect(protectedSectionsBlock(classic)).toContain("Summary, Education");
  });
});

describe("template metadata is internally consistent", () => {
  for (const t of Object.values(TEMPLATES)) {
    describe(`template "${t.id}"`, () => {
      it("lists every required and optional section in sectionOrder", () => {
        for (const s of [...t.requiredSections, ...t.optionalSections]) {
          expect(t.sectionOrder).toContain(s);
        }
      });

      it("classifies every ordered section as required or optional", () => {
        const known = new Set([...t.requiredSections, ...t.optionalSections]);
        for (const s of t.sectionOrder) expect(known.has(s)).toBe(true);
      });

      it("does not mark a section both required and optional", () => {
        const req = new Set(t.requiredSections);
        expect(t.optionalSections.some((s) => req.has(s))).toBe(false);
      });

      it("declares a plausible one-page target", () => {
        expect(t.targetChars).toBeGreaterThan(2000);
        expect(t.targetChars).toBeLessThan(6000);
      });

      it("actually contains the placeholder strings it declares", () => {
        // A stale placeholder list would let real placeholder text leak into
        // output while the prompt swore it could not.
        for (const p of t.placeholders) {
          expect(t.latex, `"${p}" missing from ${t.id}`).toContain(p);
        }
      });

      it("actually defines the macros it declares", () => {
        for (const m of t.macros) {
          // Composite entries like "aStart / aEnd" are documented as a pair.
          for (const name of m.name.split(" / ")) {
            expect(t.latex, `\\${name} missing from ${t.id}`).toContain(
              `\\newcommand{\\${name}}`,
            );
          }
        }
      });

      it("uses every section from sectionOrder in its own LaTeX", () => {
        for (const s of t.sectionOrder) {
          expect(t.latex, `\\section{${s}} missing from ${t.id}`).toContain(
            `\\section{${s}}`,
          );
        }
      });
    });
  }
});

describe("the prompts no longer hardcode a section order", () => {
  // The canonical order used to be restated in four places. It now lives in
  // template metadata; the build prompt must defer to the contract instead.
  const buildPrompt = readFileSync(
    fileURLToPath(new URL("../lib/prompts/build.ts", import.meta.url)),
    "utf8",
  );

  it("build.ts refers to the LAYOUT CONTRACT", () => {
    expect(buildPrompt).toContain("LAYOUT CONTRACT");
  });

  it("build.ts no longer names the five sections in order", () => {
    expect(buildPrompt).not.toContain(
      "Summary, Education, Skills, Experience, Projects",
    );
  });
});
