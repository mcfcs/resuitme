export type MustIncludePick = {
  item: string;
  reason: string;
};

/** Result of the one-page fitting loop, shared by tailor and build modes. */
export type BudgetInfo = {
  budget: number;
  originalChars: number;
  /** Visible-char count of the produced résumé. */
  resultChars: number;
  capped: boolean;
  iterations: number;
  cutsApplied: string[];
  fits: boolean;
  /**
   * Real page count from the compile, or null when rendering was unavailable
   * and we fell back to the visible-char heuristic.
   */
  pages: number | null;
};

/** Accent colour per mode: marigold for tailor, sage for build. */
export type Accent = "marigold" | "sage";

/**
 * Structured viability verdict.
 *
 * The scoring rubric could already express "fundamental mismatch (wrong
 * domain)" as a number below 35, but a single scalar cannot be acted on: it
 * conflates "weak but plausible" with "you are a CS student applying to an HR
 * role". This splits the two so the UI can warn honestly and the generator can
 * change strategy instead of feigning a domain fit.
 */
export type FitVerdict = {
  domain_match: "direct" | "adjacent" | "unrelated";
  seniority_match: "at" | "below" | "above";
  /** Real, nameable experience that carries over despite a domain gap. */
  transferable: string[];
  /** Requirements no rewrite can satisfy — a licence, a degree, hard years. */
  disqualifying: string[];
};

export type Analysis = {
  score: number;
  fit: FitVerdict;
  verdict: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  must_include: MustIncludePick[];
  keyword_coverage: {
    present: string[];
    missing: string[];
    partial: string[];
  };
};

export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description:
        "Overall fit rating from 0-100. Calibrate per the SCORING RUBRIC in the system prompt.",
    },
    verdict: {
      type: "string",
      description: "One-sentence verdict on the candidate's fit for this role.",
    },
    strengths: {
      type: "array",
      items: { type: "string" },
      description:
        "Bullet list (3-6 items) of the strongest matches between the input and the JD.",
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description:
        "Bullet list (3-6 items) of the most significant gaps or weaknesses relative to the JD.",
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete, specific changes that would improve the fit. 4-8 items.",
    },
    must_include: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: {
            type: "string",
            description:
              "SPECIFIC project name, role title, award name, or thesis title from the candidate's content. Never a generic category like 'ML experience' — name the actual instance.",
          },
          reason: {
            type: "string",
            description:
              "One sentence (~25 words max) citing the specific JD requirement(s) this item satisfies.",
          },
        },
        required: ["item", "reason"],
        additionalProperties: false,
      },
      description:
        "Top 3-5 items from the candidate's content that absolutely must appear in the tailored résumé. Ordered by impact (highest first).",
    },
    fit: {
      type: "object",
      properties: {
        domain_match: {
          type: "string",
          enum: ["direct", "adjacent", "unrelated"],
          description:
            "How close the candidate's FIELD is to the JD's field. 'direct' = same discipline. 'adjacent' = a neighbouring field whose skills genuinely transfer (e.g. CS applying to data analytics). 'unrelated' = a different profession entirely (e.g. a computer science student applying to a human resources, accounting, or nursing role). Judge the FIELD, not the seniority, and do not soften this: calling an unrelated role 'adjacent' misleads the candidate into a hopeless application.",
        },
        seniority_match: {
          type: "string",
          enum: ["at", "below", "above"],
          description:
            "Whether the candidate's experience level meets the JD's. 'below' = the JD wants materially more experience than they have (e.g. a senior role asking 8+ years from a student). 'above' = the candidate is overqualified.",
        },
        transferable: {
          type: "array",
          items: { type: "string" },
          description:
            "SPECIFIC, NAMED capabilities from the candidate's background that genuinely apply to this JD even across a domain gap — e.g. 'led a 5-person team', 'built financial reconciliation logic'. Never generic filler like 'communication skills' or 'hard working'. Empty when nothing meaningfully transfers.",
        },
        disqualifying: {
          type: "array",
          items: { type: "string" },
          description:
            "JD requirements that NO résumé rewrite can satisfy — a professional licence, a specific degree the candidate lacks, a legally required certification, or a hard minimum number of years. These are facts about the candidate, not gaps in how they present themselves. Empty when nothing is strictly disqualifying.",
        },
      },
      required: [
        "domain_match",
        "seniority_match",
        "transferable",
        "disqualifying",
      ],
      additionalProperties: false,
    },
    keyword_coverage: {
      type: "object",
      properties: {
        present: {
          type: "array",
          items: { type: "string" },
          description:
            "JD keywords/skills CLEARLY demonstrated by the candidate's content (explicit named usage with depth).",
        },
        missing: {
          type: "array",
          items: { type: "string" },
          description:
            "JD keywords/skills with NO evidence in the candidate's content.",
        },
        partial: {
          type: "array",
          items: { type: "string" },
          description:
            "JD keywords/skills the candidate has PARTIAL evidence for (mentioned in passing, adjacent experience, or limited depth).",
        },
      },
      required: ["present", "missing", "partial"],
      additionalProperties: false,
    },
  },
  required: [
    "score",
    "fit",
    "verdict",
    "strengths",
    "gaps",
    "suggestions",
    "must_include",
    "keyword_coverage",
  ],
  additionalProperties: false,
} as const;
