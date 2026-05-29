export type MustIncludePick = {
  item: string;
  reason: string;
};

export type Analysis = {
  score: number;
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
      description:
        "One-sentence verdict on the candidate's fit for this role.",
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
    "verdict",
    "strengths",
    "gaps",
    "suggestions",
    "must_include",
    "keyword_coverage",
  ],
  additionalProperties: false,
} as const;
