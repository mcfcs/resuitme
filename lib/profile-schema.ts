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
          description: "URLs (LinkedIn, GitHub, portfolio, etc.).",
        },
      },
      required: ["email", "phone", "location", "links"],
      additionalProperties: false,
    },
    summary: {
      type: "string",
      description:
        "Professional summary / objective if present. Empty string if absent.",
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
              "GPA, honors, relevant coursework, thesis, etc. Empty array if none.",
          },
        },
        required: ["institution", "degree", "field", "dates", "location", "details"],
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
            description: "One per bullet point under this role.",
          },
        },
        required: ["company", "role", "dates", "location", "bullets"],
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
            description: "Technologies/tools used.",
          },
          bullets: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["name", "description", "tech", "bullets"],
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
            "All distinct skills as a flat list (deduplicated across categories).",
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
        },
        required: ["name", "year", "description"],
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
        },
        required: ["title", "venue", "year"],
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
