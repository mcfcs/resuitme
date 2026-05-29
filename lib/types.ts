export type MustIncludePick = {
  item: string;
  category:
    | "experience"
    | "project"
    | "skill"
    | "education"
    | "thesis"
    | "award"
    | "publication"
    | "other";
  why: string;
};

export type Analysis = {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  must_include: MustIncludePick[];
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
              "Concise reference to the SPECIFIC item from the candidate's content — name actual experiences, projects, theses, awards, or technologies. Examples: 'aCount Sneaker Resale Platform', 'Senior Engineer role at Acme', 'Thesis: Context-Aware Sarcasm Detection', 'PyTorch + scikit-learn for ML pipelines'. Never generic categories.",
          },
          category: {
            type: "string",
            enum: [
              "experience",
              "project",
              "skill",
              "education",
              "thesis",
              "award",
              "publication",
              "other",
            ],
          },
          why: {
            type: "string",
            description:
              "One sentence (max ~25 words) on why this specific item is critical for THIS JD. Reference a JD requirement that it satisfies.",
          },
        },
        required: ["item", "category", "why"],
        additionalProperties: false,
      },
      description:
        "Top 3-5 items from the candidate's content that absolutely must appear in the tailored résumé. Specific names, not generic categories. Ordered by impact (highest first).",
    },
    keyword_coverage: {
      type: "object",
      properties: {
        matched: {
          type: "array",
          items: { type: "string" },
          description: "Important JD keywords/skills present in the input.",
        },
        missing: {
          type: "array",
          items: { type: "string" },
          description:
            "Important JD keywords/skills missing from the input.",
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
    "must_include",
    "keyword_coverage",
  ],
  additionalProperties: false,
} as const;
