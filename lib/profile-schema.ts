const SOURCES = {
  type: "array",
  items: { type: "string", enum: ["resume", "cv", "notes"] },
  description:
    "Which input(s) contributed to this item. Use 'resume' if it appears in the resume LaTeX, 'cv' if in the CV LaTeX, 'notes' if from the candidate's additional-skills notes. Include all that apply.",
} as const;

export const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Full name as it appears at the top." },
    contact: {
      type: "object",
      properties: {
        email: { type: "string" },
        phone: { type: "string" },
        location: { type: "string" },
        links: {
          type: "array",
          items: { type: "string" },
          description:
            "URLs (LinkedIn, GitHub, portfolio, etc.) — union across all sources, deduplicated.",
        },
      },
      required: ["email", "phone", "location", "links"],
      additionalProperties: false,
    },
    summary: {
      type: "string",
      description:
        "Professional summary / objective. Use the most complete version across the sources. Empty string if absent in all.",
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          institution: { type: "string" },
          degree: { type: "string" },
          field: { type: "string" },
          dates: { type: "string" },
          location: { type: "string" },
          details: {
            type: "array",
            items: { type: "string" },
            description:
              "GPA, honors, coursework, thesis. UNION across sources, deduplicated.",
          },
          sources: SOURCES,
        },
        required: [
          "institution",
          "degree",
          "field",
          "dates",
          "location",
          "details",
          "sources",
        ],
        additionalProperties: false,
      },
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          role: { type: "string" },
          dates: { type: "string" },
          location: { type: "string" },
          bullets: {
            type: "array",
            items: { type: "string" },
            description:
              "UNION of bullets across sources, deduplicated. Keep distinct accomplishments even when wording differs slightly.",
          },
          sources: SOURCES,
        },
        required: ["company", "role", "dates", "location", "bullets", "sources"],
        additionalProperties: false,
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          tech: {
            type: "array",
            items: { type: "string" },
            description: "Technologies/tools used — union, deduplicated.",
          },
          bullets: {
            type: "array",
            items: { type: "string" },
          },
          sources: SOURCES,
        },
        required: ["name", "description", "tech", "bullets", "sources"],
        additionalProperties: false,
      },
    },
    skills: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "e.g. 'Languages', 'Tools'." },
              items: { type: "array", items: { type: "string" } },
            },
            required: ["name", "items"],
            additionalProperties: false,
          },
        },
        flat: {
          type: "array",
          items: { type: "string" },
          description:
            "All distinct skills as a flat deduplicated list across all sources (resume + CV + additional skills notes).",
        },
      },
      required: ["categories", "flat"],
      additionalProperties: false,
    },
    awards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          year: { type: "string" },
          description: { type: "string" },
          sources: SOURCES,
        },
        required: ["name", "year", "description", "sources"],
        additionalProperties: false,
      },
    },
    publications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          venue: { type: "string" },
          year: { type: "string" },
          sources: SOURCES,
        },
        required: ["title", "venue", "year", "sources"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "name",
    "contact",
    "summary",
    "education",
    "experience",
    "projects",
    "skills",
    "awards",
    "publications",
  ],
  additionalProperties: false,
} as const;
