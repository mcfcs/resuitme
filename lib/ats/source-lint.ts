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
// It also catches a narrow class of COMPILE-VALIDITY errors, because a résumé
// that does not compile is a worse failure than one that extracts poorly — it
// does not exist, and the user otherwise sees only a bare "—" with no reason.
// Only hard pdflatex errors qualify (unescaped &, unbalanced braces), both
// measured in the profile-input-kind eval fixture; warnings and style are the
// compiler's business, not this lint's.
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
  "research experience",
  "teaching experience",
  "relevant experience",
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

/**
 * Environments in which `&` is a legitimate alignment character. A line inside
 * any of these is exempt from the unescaped-ampersand rule.
 */
const ALIGNMENT_ENV_NAMES = [
  "tabular\\*?",
  "tabularx",
  "tabulary",
  "longtable",
  "array",
  "align\\*?",
  "aligned",
  "alignat\\*?",
  "flalign\\*?",
  "eqnarray\\*?",
  "matrix",
  "[bpvBV]matrix",
  "smallmatrix",
  "cases",
  "split",
  "gather\\*?",
  "multline\\*?",
].join("|");

const ALIGNMENT_ENV_RE = new RegExp(
  `\\\\(begin|end)\\s*\\{(?:${ALIGNMENT_ENV_NAMES})\\}`,
  "g",
);

/**
 * Verbatim-ish spans, where braces and ampersands are literal text rather than
 * syntax. Replaced with equivalent-length blanks so offsets stay usable.
 */
const VERBATIM_RE =
  /\\begin\{verbatim\*?\}[\s\S]*?\\end\{verbatim\*?\}|\\verb\*?([^a-zA-Z\s])[\s\S]*?\1/g;

function blankVerbatim(latex: string): string {
  return latex.replace(VERBATIM_RE, (m) => m.replace(/[^\n]/g, " "));
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
 * Find a bare `&` that sits inside a brace group on a line where no alignment
 * environment is open.
 *
 * MEASURED: the profile-input-kind fixture emitted
 * `{Founder & Data Analyst}{Remote}` as an argument to \resumeSubheading and
 * failed to compile three runs in a row. \resumeSubheading *expands* to a
 * tabular*, but argument text is tokenized at the call site, where no alignment
 * is in scope, so the `&` is a hard error there.
 *
 * Deliberately conservative — it only looks inside brace groups. A bare `&` in
 * running paragraph text is equally fatal, but flagging that would require
 * knowing every alignment-providing macro in the preamble, so it is left to the
 * compiler rather than risking a false "your résumé won't compile".
 */
function findUnescapedAmpersand(
  src: string,
): { line: number; text: string } | undefined {
  const lines = src.split("\n");
  let envDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const depthBefore = envDepth;
    ALIGNMENT_ENV_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALIGNMENT_ENV_RE.exec(line))) {
      if (m[1] === "begin") envDepth++;
      else envDepth = Math.max(0, envDepth - 1);
    }
    // Skip the whole line if an alignment env was open at any point on it.
    if (depthBefore > 0 || envDepth > 0) continue;

    let braceDepth = 0;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === "\\") {
        j++; // skip the escaped char: \& \{ \} are all literal
        continue;
      }
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === "&" && braceDepth > 0) {
        return { line: i + 1, text: line.trim().slice(0, 160) };
      }
    }
  }
  return undefined;
}

/**
 * Track brace depth across the document, ignoring escaped braces, comments and
 * verbatim spans.
 *
 * MEASURED: the same failing fixture closed a group it had already closed —
 * `\small{\item{ ... }}` followed by a stray `}}` — which pdflatex reports as
 * "Too many }'s" and refuses to typeset.
 */
function findBraceImbalance(
  src: string,
): { kind: "negative" | "unclosed"; depth: number; text?: string } | undefined {
  let depth = 0;
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\n") {
      line++;
      lineStart = i + 1;
      continue;
    }
    if (ch === "\\") {
      i++; // escaped char, including \{ and \}
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) {
        const end = src.indexOf("\n", i);
        return {
          kind: "negative",
          depth,
          text: src
            .slice(lineStart, end === -1 ? undefined : end)
            .trim()
            .slice(0, 160),
        };
      }
    }
  }
  if (depth > 0) return { kind: "unclosed", depth };
  return undefined;
}

/**
 * Analyze LaTeX source for constructs that break résumé parsers.
 * Findings are ordered critical → warning → info.
 */
export function lintLatexForAts(latex: string): AtsFinding[] {
  if (!latex?.trim()) return [];
  const src = stripComments(latex);
  const out: AtsFinding[] = [];

  // --- critical: source that will not compile at all ----------------------
  // A résumé that fails to compile is a worse outcome than one that extracts
  // poorly: it does not exist. Both rules below are hard pdflatex errors that
  // were observed as bare "—" results in the eval harness.
  const codeSrc = blankVerbatim(src);

  const amp = findUnescapedAmpersand(codeSrc);
  if (amp) {
    out.push({
      id: "unescaped-ampersand",
      severity: "critical",
      title: "Unescaped & in a macro argument",
      detail:
        '& is LaTeX\'s alignment character. Outside a tabular or align row it is a hard error — pdflatex aborts with "Misplaced alignment tab character &" and produces no PDF. A macro that expands to a tabular does not help: its arguments are read at the call site, where no alignment is in scope.',
      fix: 'Escape it as \\& (e.g. {Founder \\& Data Analyst}), or write "and".',
      evidence: amp.text,
    });
  }

  const braces = findBraceImbalance(codeSrc);
  if (braces) {
    out.push({
      id: "unbalanced-braces",
      severity: "critical",
      title:
        braces.kind === "negative"
          ? "Extra closing brace"
          : "Unclosed brace group",
      detail:
        braces.kind === "negative"
          ? 'A } closes a group that was never opened. pdflatex reports "Too many }\'s" and stops — no PDF is produced.'
          : `${braces.depth} brace group${braces.depth > 1 ? "s are" : " is"} still open at the end of the document. pdflatex reaches \\end{document} with an unfinished group and aborts with "Missing } inserted".`,
      fix:
        braces.kind === "negative"
          ? "Remove the extra closing brace."
          : "Add the missing closing brace(s) to the unfinished group.",
      evidence: braces.text,
    });
  }

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
