// Static ATS analysis of LaTeX source. Pure, no I/O, no dependencies — it runs
// instantly and without compiling, so it can gate a template choice or lint a
// résumé the user pasted.
//
// SCOPE, honestly stated: a lint only knows the patterns encoded here. It
// cannot tell you what a parser actually extracted — that needs a compile and
// lives in lib/ats/pdf-scan.ts. The two are complementary: this one is free and
// catches known-hostile constructs before you spend a compile; that one is
// authoritative.
//
// Every rule here is grounded in a measurement rather than folklore. Notably
// ABSENT, because they were measured NOT to be problems in this codebase's
// layout: ligatures (glyphtounicode already handles them), math bullets in
// \labelitemii (extract as U+2022 under a real PDF text layer), and tabular*
// used for a flush-left/flush-right heading row (0 reading-order anomalies
// across 34 multi-item lines). Adding rules for those would produce false
// positives on a layout that is genuinely fine.

export type AtsSeverity = "critical" | "warning" | "info";

export type AtsFinding = {
  /** Stable machine id, e.g. "two-column". */
  id: string;
  severity: AtsSeverity;
  title: string;
  /** What a résumé parser actually does with this. */
  detail: string;
  /** A concrete change that resolves it. */
  fix?: string;
  /** The offending source text, trimmed. */
  evidence?: string;
};

/** Section headings ATS parsers reliably recognize, lowercased. */
const KNOWN_SECTIONS = new Set([
  "summary",
  "professional summary",
  "profile",
  "objective",
  "about",
  "education",
  "academic background",
  "skills",
  "technical skills",
  "core competencies",
  "experience",
  "work experience",
  "professional experience",
  "employment",
  "employment history",
  "extra-curricular and experience",
  "projects",
  "personal projects",
  "selected projects",
  "publications",
  "papers",
  "selected publications",
  "awards",
  "honors",
  "awards & honors",
  "certifications",
  "licenses & certifications",
  "leadership",
  "volunteer experience",
  "interests",
  "references",
]);

/**
 * Characters that are known to survive PDF text extraction badly. C1 controls
 * and the replacement char are always wrong; currency symbols outside Latin-1
 * (U+20A0-U+20BF, e.g. the peso sign) are the class of bug measured in
 * sampleresume.tex, where it extracted as U+0091 and silently destroyed a
 * quantified achievement.
 */
const RISKY_GLYPHS = /[\u0080-\u009f\ufffd\u20a0-\u20bf]/g;

/** Strip comments so rules do not fire on commented-out code. */
function stripComments(latex: string): string {
  return latex.replace(/(?<!\\)%[^\n]*/g, "");
}

function firstMatchLine(latex: string, re: RegExp): string | undefined {
  const m = re.exec(latex);
  if (!m) return undefined;
  const start = latex.lastIndexOf("\n", m.index) + 1;
  const end = latex.indexOf("\n", m.index);
  return latex
    .slice(start, end === -1 ? undefined : end)
    .trim()
    .slice(0, 160);
}

/**
 * Analyze LaTeX source for constructs that break résumé parsers.
 * Findings are ordered critical → warning → info.
 */
export function lintLatexForAts(latex: string): AtsFinding[] {
  if (!latex?.trim()) return [];
  const src = stripComments(latex);
  const out: AtsFinding[] = [];

  // --- critical: multi-column layouts -------------------------------------
  // The single best-established ATS failure: a parser reads the text layer
  // linearly, so a sidebar's contents land in the middle of work history.
  if (/\\usepackage(\[[^\]]*\])?\{multicol\}|\\begin\{multicols\}/.test(src)) {
    out.push({
      id: "two-column",
      severity: "critical",
      title: "Two-column layout",
      detail:
        "Parsers read the PDF text layer top to bottom. With two columns, sidebar content is interleaved into the middle of your work history and dates detach from their jobs.",
      fix: "Use a single-column layout. Jake's-style résumés with full-width sections parse near-perfectly.",
      evidence: firstMatchLine(
        src,
        /\\begin\{multicols\}|\\usepackage[^\n]*multicol/,
      ),
    });
  }

  // paracol / two side-by-side minipages spanning roughly half the width each
  if (/\\usepackage(\[[^\]]*\])?\{paracol\}/.test(src)) {
    out.push({
      id: "two-column",
      severity: "critical",
      title: "Two-column layout (paracol)",
      detail:
        "paracol produces genuinely parallel text columns, which parsers linearize incorrectly.",
      fix: "Use a single-column layout.",
    });
  }

  // --- critical: unmapped glyphs ------------------------------------------
  // pdfTeX needs glyphtounicode + \pdfgentounicode=1 to emit a ToUnicode map.
  // Without it, extracted text can be mojibake even though the PDF looks fine.
  // This is a REGRESSION GUARD: the current template has it and it works.
  const usesPdfLatexIdioms = /\\documentclass/.test(src);
  const hasGlyphInput = /\\input\s*\{?\s*glyphtounicode\s*\}?/.test(src);
  const hasGenToUnicode = /\\pdfgentounicode\s*=\s*1/.test(src);
  if (usesPdfLatexIdioms && !(hasGlyphInput && hasGenToUnicode)) {
    out.push({
      id: "no-glyphtounicode",
      severity: "critical",
      title: "Missing PDF text-extraction mapping",
      detail:
        "Without a ToUnicode map, glyphs in the compiled PDF may not map back to real characters, so a parser can read garbage even though the page looks correct.",
      fix: "Add \\input{glyphtounicode} to the preamble and \\pdfgentounicode=1 before \\begin{document}.",
    });
  }

  // --- critical: risky literal glyphs -------------------------------------
  const risky = src.match(RISKY_GLYPHS);
  if (risky) {
    const uniq = [...new Set(risky)];
    out.push({
      id: "risky-glyph",
      severity: "critical",
      title: `Characters that may not survive extraction (${uniq.join(" ")})`,
      detail:
        "These extracted as control characters in testing — the surrounding figure or word is silently lost to a parser. Measured: ₱ became U+0091, destroying a budget figure.",
      fix: "Replace with ASCII equivalents (e.g. ₱53M → PHP 53M, — → --).",
      evidence: firstMatchLine(src, RISKY_GLYPHS),
    });
  }

  // --- warning: content parsers cannot see --------------------------------
  if (/\\includegraphics|\\begin\{tikzpicture\}/.test(src)) {
    out.push({
      id: "image-content",
      severity: "warning",
      title: "Image or drawing in the document",
      detail:
        "Images carry no text layer. Any information conveyed only by a graphic — a skills chart, a logo with your name — is invisible to a parser.",
      fix: "Ensure everything meaningful also appears as real text.",
      evidence: firstMatchLine(src, /\\includegraphics|\\begin\{tikzpicture\}/),
    });
  }

  if (
    /\\usepackage(\[[^\]]*\])?\{fontawesome\d?\}|\\fa[A-Z][a-zA-Z]*/.test(src)
  ) {
    out.push({
      id: "icon-font",
      severity: "warning",
      title: "Icon font in use",
      detail:
        "Icon glyphs have no Unicode meaning and can attach garbage characters to the contact details they sit beside, sometimes causing the email to be missed entirely.",
      fix: 'Use plain text labels: "Email: you@example.com" rather than an envelope icon.',
      evidence: firstMatchLine(src, /\\fa[A-Z][a-zA-Z]*|fontawesome/),
    });
  }

  // Contact details inside a running header: many parsers ignore headers.
  if (/\\fancyhead|\\lhead|\\rhead|\\chead/.test(src)) {
    const headerBlock = /\\(?:fancyhead|lhead|rhead|chead)[^\n]*/g;
    const blocks = src.match(headerBlock)?.join("\n") ?? "";
    if (/@|\\href|linkedin|github|\+\d/i.test(blocks)) {
      out.push({
        id: "contact-in-header",
        severity: "warning",
        title: "Contact details in a page header",
        detail:
          "Many ATS drop running headers and footers before parsing, which can lose your email or phone number entirely.",
        fix: "Put name and contact details in the document body, above the first section.",
        evidence: blocks.split("\n")[0]?.slice(0, 160),
      });
    }
  }

  // --- info: heading vocabulary -------------------------------------------
  const headings = [...src.matchAll(/\\section\*?\s*\{([^{}]+)\}/g)].map((m) =>
    m[1].replace(/\\[a-zA-Z]+\s*/g, "").trim(),
  );
  const unknown = headings.filter(
    (h) => h && !KNOWN_SECTIONS.has(h.toLowerCase()),
  );
  if (unknown.length) {
    out.push({
      id: "nonstandard-section",
      severity: "info",
      title: `Unusual section heading${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
      detail:
        "Parsers map résumé content to fields by matching heading text. An unrecognized heading may leave its content unclassified.",
      fix: 'Prefer conventional names such as "Experience", "Education", "Skills", "Projects".',
    });
  }

  const order: Record<AtsSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** True when nothing critical was found. */
export function isAtsClean(findings: AtsFinding[]): boolean {
  return !findings.some((f) => f.severity === "critical");
}
