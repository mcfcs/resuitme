// Pure analysis of an extracted PDF text layer — the part a résumé parser
// actually sees. No I/O, no PDF library, so all of it is unit-testable against
// hand-written fixtures.
//
// The detectors here were chosen by testing them against two real compiled
// documents: the app's own résumé (known good) and a deliberately two-column
// control (known hostile). What survived:
//
//   badGlyphRatio  — caught the real defect (a peso sign extracting as U+0091).
//   columnBreaks   — caught the two-column control. This is the one that works:
//                    when a parser walks the text stream of a two-column page,
//                    the y-coordinate JUMPS BACK UP at the column boundary.
//   orderAnomalies — kept as a secondary signal. On its own it MISSED the
//                    two-column control entirely (0 anomalies), because each
//                    column's lines are internally well-ordered. Documented
//                    here so nobody mistakes it for the column detector.

export type TextItem = {
  str: string;
  /** PDF user-space x of the item's start. */
  x: number;
  /** PDF user-space y of the item's baseline. Larger y is HIGHER on the page. */
  y: number;
  width: number;
  height: number;
};

export type AtsCheckId =
  | "text-extractable"
  | "glyph-integrity"
  | "reading-order"
  | "single-column"
  | "standard-sections"
  | "contact-parseable";

export type AtsCheckResult = {
  id: AtsCheckId;
  label: string;
  /** 0..1 — how well this check passed. */
  ratio: number;
  weight: number;
  /** Points earned, i.e. round(ratio * weight). */
  points: number;
  passed: boolean;
  detail: string;
};

export type AtsScore = {
  /** 0..100 */
  score: number;
  checks: AtsCheckResult[];
};

/**
 * Weights are a transparent deduction, never a black box — users rightly
 * distrust an opaque "ATS score". Extraction and glyph integrity together
 * carry 55 because they are binary catastrophes: a résumé whose text cannot be
 * read scores near zero no matter how good its headings are, and that should
 * be visible in the number.
 *
 * single-column outweighs reading-order because measurement showed the column
 * break is the signal that actually detects a two-column layout, while the
 * within-line order check missed one entirely. A column break scores 0 for the
 * whole check rather than a partial deduction: interleaving a sidebar into
 * work history is a categorical failure, not a blemish.
 */
export const ATS_WEIGHTS: Record<AtsCheckId, number> = {
  "text-extractable": 30,
  "glyph-integrity": 25,
  "reading-order": 10,
  "single-column": 20,
  "standard-sections": 10,
  "contact-parseable": 5,
};

/** Characters that indicate a broken text layer. */
// eslint-disable-next-line no-control-regex
const BAD_GLYPH =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd]/g;

/** Group items into visual lines by baseline y, tolerant of small jitter. */
export function groupIntoLines(items: TextItem[], tolerance = 3): TextItem[][] {
  const lines: TextItem[][] = [];
  for (const item of items) {
    const line = lines.find((l) => Math.abs(l[0].y - item.y) <= tolerance);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines;
}

/**
 * Visual lines whose stream order differs from their left-to-right order.
 *
 * SECONDARY SIGNAL. It catches a genuinely scrambled row, but it does NOT
 * detect two-column layouts — measured 0 anomalies on a real multicols
 * document, because each column is internally ordered. Use columnBreaks for
 * that.
 */
export function countOrderAnomalies(items: TextItem[]): number {
  let anomalies = 0;
  for (const line of groupIntoLines(items)) {
    if (line.length < 2) continue;
    const byX = [...line].sort((a, b) => a.x - b.x);
    if (byX.some((it, i) => it !== line[i])) anomalies++;
  }
  return anomalies;
}

/**
 * Count places where the text stream jumps back UP the page.
 *
 * This is the two-column signature: after the last line of column one, the
 * stream resumes at the top of column two, so y increases sharply. A
 * single-column document walks monotonically down and never does this.
 *
 * Measured: 0 on the app's résumé, 1 (a 66pt jump) on a two-column control.
 */
export function countColumnBreaks(items: TextItem[], minJump = 40): number {
  let breaks = 0;
  for (let i = 1; i < items.length; i++) {
    if (items[i].y - items[i - 1].y > minJump) breaks++;
  }
  return breaks;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;

/** Section headings a parser is likely to recognize, lowercased. */
const KNOWN_HEADINGS = [
  "summary",
  "profile",
  "objective",
  "education",
  "skills",
  "experience",
  "employment",
  "projects",
  "publications",
  "awards",
  "honors",
  "certifications",
  "leadership",
];

export type ScanFacts = {
  /** Concatenated extracted text, in stream order. */
  text: string;
  items: TextItem[];
  pages: number;
};

/**
 * Score a text layer. Every deduction is explained in the returned checks so
 * the UI can show its work.
 */
export function scoreExtraction(facts: ScanFacts): AtsScore {
  const { text, items } = facts;
  const chars = text.length;

  // --- text-extractable ---------------------------------------------------
  // A résumé that yields almost no text is an image or has outlined fonts.
  const extractable = chars >= 400;
  const extractRatio = extractable ? 1 : Math.min(1, chars / 400);

  // --- glyph-integrity ----------------------------------------------------
  const bad = (text.match(BAD_GLYPH) ?? []).length;
  const badRatio = chars ? bad / chars : 1;
  // Any bad glyph is a real defect; scale steeply so a handful is visible.
  const glyphRatio = chars ? Math.max(0, 1 - badRatio * 200) : 0;

  // --- reading-order ------------------------------------------------------
  const lines = groupIntoLines(items);
  const multi = lines.filter((l) => l.length > 1).length;
  const anomalies = countOrderAnomalies(items);
  const orderRatio = multi ? Math.max(0, 1 - anomalies / multi) : 1;

  // --- single-column ------------------------------------------------------
  const breaks = countColumnBreaks(items);
  const columnRatio = breaks === 0 ? 1 : 0;

  // --- standard-sections --------------------------------------------------
  const lower = text.toLowerCase();
  const found = KNOWN_HEADINGS.filter((h) => lower.includes(h));
  // Three recognizable headings is a normal résumé; more is not better.
  const sectionRatio = Math.min(1, found.length / 3);

  // --- contact-parseable --------------------------------------------------
  // The one end-to-end check: does the email survive extraction as something
  // a regex can find? If not, nothing downstream matters.
  const hasEmail = EMAIL.test(text);
  const hasPhone = PHONE.test(text);
  const contactRatio = hasEmail ? (hasPhone ? 1 : 0.7) : 0;

  const mk = (
    id: AtsCheckId,
    label: string,
    ratio: number,
    detail: string,
  ): AtsCheckResult => {
    const weight = ATS_WEIGHTS[id];
    const clamped = Math.max(0, Math.min(1, ratio));
    return {
      id,
      label,
      ratio: clamped,
      weight,
      points: Math.round(clamped * weight),
      passed: clamped >= 0.999,
      detail,
    };
  };

  const checks: AtsCheckResult[] = [
    mk(
      "text-extractable",
      "Text is extractable",
      extractRatio,
      extractable
        ? `${chars} characters of real text recovered.`
        : `Only ${chars} characters recovered — the PDF may be an image or use outlined fonts.`,
    ),
    mk(
      "glyph-integrity",
      "Characters survive extraction",
      glyphRatio,
      bad === 0
        ? "No corrupted characters."
        : `${bad} character${bad === 1 ? "" : "s"} extracted as control or replacement codes — the surrounding words are lost to a parser.`,
    ),
    mk(
      "reading-order",
      "Reading order is preserved",
      orderRatio,
      anomalies === 0
        ? `All ${multi} multi-item lines read left to right.`
        : `${anomalies} of ${multi} lines are out of order in the text stream.`,
    ),
    mk(
      "single-column",
      "Single-column flow",
      columnRatio,
      breaks === 0
        ? "The text stream runs top to bottom without jumping back up the page."
        : `The text stream jumps back up the page ${breaks} time${breaks === 1 ? "" : "s"} — the signature of a multi-column layout, which parsers interleave incorrectly.`,
    ),
    mk(
      "standard-sections",
      "Recognizable section headings",
      sectionRatio,
      found.length
        ? `Found: ${found.slice(0, 6).join(", ")}.`
        : "No conventional section headings found in the extracted text.",
    ),
    mk(
      "contact-parseable",
      "Contact details are parseable",
      contactRatio,
      hasEmail
        ? hasPhone
          ? "Email and phone both recoverable."
          : "Email recoverable; no phone number found."
        : "No email address could be recovered from the extracted text.",
    ),
  ];

  // If the text layer is essentially empty, nothing else can be meaningfully
  // true: "reading order preserved" over zero items is vacuous, not a pass.
  // Without this cascade an image-only PDF scores ~30 for checks that never
  // had any text to examine.
  if (!extractable) {
    for (const c of checks) {
      if (c.id === "text-extractable") continue;
      c.ratio *= extractRatio;
      c.points = Math.round(c.ratio * c.weight);
      c.passed = false;
    }
  }

  const score = checks.reduce((s, c) => s + c.points, 0);
  return { score, checks };
}
