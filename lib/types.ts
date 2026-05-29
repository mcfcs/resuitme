export type Analysis = {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  keyword_coverage: {
    matched: string[];
    missing: string[];
  };
};

export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description:
        "Overall fit rating from 0-100. 0 = no relevant overlap. 100 = perfect match.",
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
        "Bullet list (3-6 items) of the strongest matches between the resume and the JD.",
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
        "Concrete, specific changes that would improve the resume's fit. 4-8 items.",
    },
    keyword_coverage: {
      type: "object",
      properties: {
        matched: {
          type: "array",
          items: { type: "string" },
          description: "Important JD keywords/skills present in the resume.",
        },
        missing: {
          type: "array",
          items: { type: "string" },
          description:
            "Important JD keywords/skills missing from the resume.",
        },
      },
      required: ["matched", "missing"],
      additionalProperties: false,
    },
  },
  required: [
    "score",
    "verdict",
    "strengths",
    "gaps",
    "suggestions",
    "keyword_coverage",
  ],
  additionalProperties: false,
} as const;
