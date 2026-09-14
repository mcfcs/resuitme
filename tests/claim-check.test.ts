import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findUngroundedClaims, softenClaims } from "@/lib/ats/claim-check";
import { TEMPLATES } from "@/lib/templates";

const SAMPLE = readFileSync(
  fileURLToPath(new URL("../sampleresume.tex", import.meta.url)),
  "utf8",
);

/**
 * The e-commerce profile behind the measured fabrications. It contains no
 * leadership verb, no scale word, no seniority and no duration — so any such
 * claim written from it was invented.
 */
const PROFILE = [
  "Independent E-commerce Operator (Retail), Self-Employed, 2020 -- Present.",
  "Operated a sneaker resale business across local and international",
  "marketplaces including StockX and Alias, coordinating sourcing,",
  "authentication, and cross-border logistics.",
  "Developed demand-based dynamic pricing strategies to maximize margins",
  "and inventory turnover.",
  "Built a full-stack financial management app that automates sale tracking.",
].join(" ");

/** Wrap bullets in the minimum LaTeX the scanner needs. */
function doc(...bullets: string[]): string {
  return [
    "\\begin{document}",
    "\\resumeItemListStart",
    ...bullets.map((b) => `  \\resumeItem{${b}}`),
    "\\resumeItemListEnd",
    "\\end{document}",
  ].join("\n");
}

const triggers = (latex: string, pool = PROFILE) =>
  findUngroundedClaims(latex, pool).map((c) => c.trigger);

describe("findUngroundedClaims — zero false positives on real material", () => {
  it("finds nothing when the résumé is the candidate's own", () => {
    // sampleresume.tex describes REAL leadership ("1st Place, Team Leader",
    // "Led a 5-member team") and real management ("Managed payment
    // collection"). Every one of those is grounded by the pool being the
    // same document, and flagging any of them would tell the candidate their
    // real achievement was invented.
    expect(findUngroundedClaims(SAMPLE, SAMPLE)).toEqual([]);
  });

  it("finds nothing in any built-in template's placeholder text", () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(findUngroundedClaims(t.latex, t.latex)).toEqual([]);
    }
  });

  it("returns nothing for empty input", () => {
    expect(findUngroundedClaims("", PROFILE)).toEqual([]);
    expect(findUngroundedClaims("   ", PROFILE)).toEqual([]);
  });
});

describe("findUngroundedClaims — leadership", () => {
  it("flags a leadership verb the pool never uses", () => {
    expect(
      triggers(doc("Led the development of a dynamic pricing strategy")),
    ).toEqual(["led"]);
  });

  it("grounds a verb through a listed synonym", () => {
    // "Team Leader" in the pool grounds "led" in the output.
    const pool = `${PROFILE} IM Summit 2026, 1st Place, Team Leader.`;
    expect(triggers(doc("Led the design of a platform"), pool)).toEqual([]);
  });

  it("grounds managed via management, and mentored via mentorship", () => {
    const pool = `${PROFILE} Inventory management across marketplaces. Peer mentorship programme.`;
    expect(
      triggers(doc("Managed inventory", "Mentored new sellers"), pool),
    ).toEqual([]);
  });

  it("does not let an unrelated root ground the claim", () => {
    // "their own" must not ground "owned"; "direct impact" must not ground
    // "directed"; a section "heading" must not ground "headed".
    const pool = `${PROFILE} Sellers set their own prices with direct impact on margin. Section heading.`;
    expect(
      triggers(
        doc("Owned pricing", "Directed sourcing", "Headed logistics"),
        pool,
      ),
    ).toEqual(["owned", "directed", "headed"]);
  });

  it("is case-insensitive on the claim", () => {
    expect(triggers(doc("LED a rollout"))).toEqual(["led"]);
  });

  it("does not fire on 'lead' or 'leading', which are usually not the verb", () => {
    expect(
      triggers(doc("Built a lead-scoring model with leading indicators")),
    ).toEqual([]);
  });
});

describe("findUngroundedClaims — scale and scope", () => {
  it("flags scope claims the pool does not make", () => {
    expect(
      triggers(
        doc(
          "Ran pricing at scale across enterprise-grade, mission-critical, cross-functional pipelines",
        ),
      ),
    ).toEqual([
      "at scale",
      "enterprise grade",
      "mission critical",
      "cross functional",
    ]);
  });

  it("grounds a scope claim the pool actually makes", () => {
    const pool = `${PROFILE} Cross-functional finance team. Enterprise clients.`;
    expect(
      triggers(
        doc("Worked with a cross-functional team on enterprise accounts"),
        pool,
      ),
    ).toEqual([]);
  });

  it("accepts a hyphen or a space in either the claim or the pool", () => {
    const pool = `${PROFILE} large scale batch jobs`;
    expect(triggers(doc("Ran large-scale batch jobs"), pool)).toEqual([]);
  });
});

describe("findUngroundedClaims — seniority", () => {
  it("flags a team size the pool does not put next to a team", () => {
    // A bare "5" elsewhere in the pool grounds the FIGURE for the numeric
    // check; it must not ground the team.
    const pool = `${PROFILE} GPA 3.5. 5 marketplaces.`;
    expect(triggers(doc("Led a team of 5 to build the app"), pool)).toEqual([
      "led",
      "team of 5",
    ]);
  });

  it("grounds a team size stated either way round in the pool", () => {
    const pool = `${PROFILE} Led a 5-member team to design DigiTALINO.`;
    expect(triggers(doc("Led a team of 5 engineers"), pool)).toEqual([]);
    expect(triggers(doc("5-person team lead"), pool)).toEqual([]);
  });

  it("flags stakeholders and direct reports the pool never mentions", () => {
    expect(
      triggers(
        doc("Presented pricing to stakeholders", "Had 3 direct reports"),
      ),
    ).toEqual(["stakeholders", "direct reports"]);
  });

  it("flags a title modifier the pool does not carry", () => {
    expect(triggers(doc("Senior Software Engineer on the platform"))).toEqual([
      "senior",
    ]);
    expect(
      triggers(doc("Senior Data Analyst"), `${PROFILE} Senior thesis project.`),
    ).toEqual([]);
  });

  it("leaves a bare job title alone", () => {
    expect(triggers(doc("Software Engineer on the platform"))).toEqual([]);
  });
});

describe("findUngroundedClaims — duration", () => {
  it("flags years of experience with a figure the pool has only elsewhere", () => {
    // The 5 in "5 marketplaces" satisfies the numeric check; it must not
    // satisfy a duration.
    const pool = `${PROFILE} Sold on 5 marketplaces.`;
    expect(triggers(doc("5+ years of experience in e-commerce"), pool)).toEqual(
      ["5 years"],
    );
  });

  it("grounds a duration the pool actually states", () => {
    const pool = `${PROFILE} 5 years of hands-on retail experience.`;
    expect(triggers(doc("5+ years of experience in e-commerce"), pool)).toEqual(
      [],
    );
  });

  it("flags years of experience with no figure at all", () => {
    expect(triggers(doc("Years of professional experience in retail"))).toEqual(
      ["years of experience"],
    );
  });

  it("ignores dates and year numbers", () => {
    expect(triggers(doc("Operated the business from 2020 to 2026"))).toEqual(
      [],
    );
  });
});

describe("findUngroundedClaims — context and softening preview", () => {
  it("reports the bullet the claim sits in and what it becomes", () => {
    const [c] = findUngroundedClaims(
      doc("Led a team of engineers to \\textbf{build} the pricing engine"),
      PROFILE,
    );
    expect(c.kind).toBe("leadership");
    expect(c.context).toBe(
      "Led a team of engineers to build the pricing engine",
    );
    expect(c.softened).toBe("Built the pricing engine");
  });

  it("reports null when the bullet cannot be kept", () => {
    const [c] = findUngroundedClaims(
      doc("Mentored three junior sellers"),
      PROFILE,
    );
    expect(c.softened).toBeNull();
  });
});

describe("softenClaims — the code backstop", () => {
  it("leaves a clean draft untouched", () => {
    const latex = doc("Developed demand-based dynamic pricing strategies");
    expect(softenClaims(latex, PROFILE)).toEqual({ latex, softened: [] });
  });

  it("re-heads a team-leadership clause with the real verb", () => {
    const { latex, softened } = softenClaims(
      doc("Led a team to design the pricing dashboard"),
      PROFILE,
    );
    expect(latex).toContain("\\resumeItem{Designed the pricing dashboard}");
    expect(softened).toEqual([
      {
        claim: "Led",
        kind: "leadership",
        bullet: "Led a team to design the pricing dashboard",
        replacement: "Designed the pricing dashboard",
      },
    ]);
  });

  it("keeps a macro wrapped around the re-headed verb balanced", () => {
    const { latex } = softenClaims(
      doc("Led a team of engineers to \\textbf{build} the pricing engine"),
      PROFILE,
    );
    expect(latex).toContain("{\\textbf{Built} the pricing engine}");
  });

  it("handles irregular and short verbs in the re-head", () => {
    expect(
      softenClaims(doc("Led a team of interns to build the parser"), PROFILE)
        .latex,
    ).toContain("{Built the parser}");
    // Not "Managed": the fixture profile's "financial management app"
    // grounds that verb, which is the conservative call this module makes.
    expect(
      softenClaims(doc("Led a squad to ship the parser"), PROFILE).latex,
    ).toContain("{Shipped the parser}");
    expect(
      softenClaims(doc("Led a group to run the pipeline"), PROFILE).latex,
    ).toContain("{Ran the pipeline}");
  });

  it("does not re-head when nothing team-like sits before the 'to'", () => {
    // "Led migration to AWS" must never become "AWSed".
    const { latex } = softenClaims(doc("Led the migration to AWS"), PROFILE);
    expect(latex).toContain("{Contributed to the migration to AWS}");
  });

  it("softens a leading verb without a team clause to a contribution", () => {
    const { latex } = softenClaims(
      doc("Owned the deployment pipeline"),
      PROFILE,
    );
    expect(latex).toContain("{Contributed to the deployment pipeline}");
  });

  it("softens a mid-bullet verb in place", () => {
    const { latex } = softenClaims(
      doc("Built the pricing model and led its rollout"),
      PROFILE,
    );
    expect(latex).toContain(
      "{Built the pricing model and contributed to its rollout}",
    );
  });

  it("deletes a scope word and closes the gap", () => {
    const { latex } = softenClaims(
      doc("Ran a pricing service at scale for cross-functional users"),
      PROFILE,
    );
    expect(latex).toContain("{Ran a pricing service for users}");
  });

  it("removes a stakeholder clause behind its preposition", () => {
    const { latex } = softenClaims(
      doc("Presented margin analysis to key stakeholders"),
      PROFILE,
    );
    expect(latex).toContain("{Presented margin analysis}");
  });

  it("shrinks an invented team size to just a team", () => {
    expect(
      softenClaims(doc("Coordinated a 12-member team on sourcing"), PROFILE)
        .latex,
    ).toContain("{Coordinated a team on sourcing}");
    expect(
      softenClaims(doc("Coordinated a team of 12 on sourcing"), PROFILE).latex,
    ).toContain("{Coordinated a team on sourcing}");
  });

  it("drops a title modifier", () => {
    expect(
      softenClaims(doc("Senior Engineer for the pricing service"), PROFILE)
        .latex,
    ).toContain("{Engineer for the pricing service}");
  });

  it("removes an invented duration and keeps the experience", () => {
    expect(
      softenClaims(
        doc("Retail operator with over 5 years of experience in resale"),
        PROFILE,
      ).latex,
    ).toContain("{Retail operator with experience in resale}");
    expect(
      softenClaims(doc("5+ years of experience in e-commerce"), PROFILE).latex,
    ).toContain("{Experience in e-commerce}");
  });

  it("rewrites a bullet with two claims once, both removed", () => {
    const { latex, softened } = softenClaims(
      doc("Led a team of 4 to build a mission-critical pricing engine"),
      PROFILE,
    );
    expect(latex).toContain("{Built a pricing engine}");
    expect(softened.map((s) => s.claim)).toEqual([
      "Led",
      "team of 4",
      "mission-critical",
    ]);
    expect(new Set(softened.map((s) => s.replacement)).size).toBe(1);
  });

  it("drops a bullet no rule can rescue, and reports it", () => {
    const { latex, softened } = softenClaims(
      doc("Developed pricing strategies", "Mentored three junior sellers"),
      PROFILE,
    );
    expect(latex).toContain("{Developed pricing strategies}");
    expect(latex).not.toContain("Mentored");
    expect(softened[0].replacement).toBeNull();
  });

  it("removes an emptied bullet list so the draft still compiles", () => {
    // \begin{itemize}\end{itemize} is a LaTeX error; a dropped bullet must
    // never turn a compilable draft into one that does not compile.
    const { latex } = softenClaims(
      doc("Mentored three junior sellers"),
      PROFILE,
    );
    expect(latex).not.toContain("\\resumeItemListStart");
    expect(latex).not.toContain("\\resumeItemListEnd");
  });

  it("drops a bullet that softening leaves too short to mean anything", () => {
    const { latex } = softenClaims(doc("Led stakeholders"), PROFILE);
    expect(latex).not.toContain("stakeholders");
    expect(latex).not.toContain("\\resumeItem{");
  });

  it("edits the enclosing line when a bullet is a bare \\item", () => {
    const latex = [
      "\\begin{document}",
      "\\begin{itemize}",
      "  \\item Led the pricing work at scale",
      "  \\item Built the parser",
      "\\end{itemize}",
      "\\end{document}",
    ].join("\n");
    const out = softenClaims(latex, PROFILE).latex;
    expect(out).toContain("\\item Contributed to the pricing work");
    expect(out).toContain("\\item Built the parser");
  });

  it("leaves the preamble alone even when it contains a trigger word", () => {
    const latex =
      "% managed by the template author\n\\documentclass{article}\n" +
      doc("Developed pricing strategies");
    expect(softenClaims(latex, PROFILE).latex).toBe(latex);
  });

  it("does not disturb sampleresume.tex when it is its own pool", () => {
    expect(softenClaims(SAMPLE, SAMPLE).latex).toBe(SAMPLE);
  });
});
