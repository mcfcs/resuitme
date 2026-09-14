// Catch quantitative claims in a generated résumé that the candidate's own
// material does not support.
//
// A number is the most dangerous thing a model can invent, because it is the
// most persuasive thing on the page and the one an interviewer will ask about.
// Measured: from a profile line that reads "Developed demand-based dynamic
// pricing strategies to maximize margins and inventory turnover" — containing
// no figure at all — the generator produced "boosting inventory turnover by
// 15\%" and "reducing manual audit time by 30\%". Neither 15 nor 30 appears
// anywhere in the source. Prose-level grounding (lib/ats/quote-check.ts) does
// not catch this: the surrounding words really are the candidate's, only the
// figure is fabricated.
//
// TRADE-OFF, stated plainly and opposite to quote-check.ts: that module is
// deliberately STRICT because a rejected addition costs one dropped bullet.
// This one is deliberately CONSERVATIVE. It flags figures on a résumé the
// candidate believes in, so a false positive tells someone their real
// achievement was invented — worse than quietly missing one fabrication. When
// in doubt, a figure is treated as grounded. Every skip rule below exists
// because it removed a class of false positive, not because it caught more.
//
// Pure and dependency-free so it is unit-testable without a model.

import { bulletTextAt, enclosingBullet } from "./bullets";

/** A figure found in generated output, and whether the source supports it. */
export type NumericClaim = {
  /** As it appeared, e.g. "15\\%" or "700,000+". */
  raw: string;
  /** Normalised for comparison, e.g. "15". */
  value: string;
  /** The surrounding text, trimmed, for evidence in a finding. */
  context: string;
};

/** Units that make a figure layout rather than achievement. */
const LENGTH_UNITS =
  /^(?:in|pt|em|ex|cm|mm|px|\\textwidth|\\linewidth|\\textheight|\\baselineskip)\b/;

/**
 * Version-like tokens that are part of a technology's NAME, not a metric.
 * "OAuth 2.0" and "Web 3.0" put a space before the digits, so the generic
 * "digit bound to a preceding word" rule cannot see them.
 */
const TECH_TOKENS =
  /\b(?:oauth|http|https|python|java|node|php|ruby|perl|go|rust|swift|kotlin|scala|c|c\+\+|es|web|html|css|sass|angular|react|vue|next|nuxt|django|flask|spring|rails|net|dotnet|tls|ssl|ipv|usb|wi-?fi|bluetooth|sql|postgres|postgresql|mysql|mongodb|redis|windows|macos|ios|android|ubuntu|debian|cuda|opengl|directx|unicode|utf|iso|rfc|ieee|nist|sp|gpt|llama|bert|resnet|yolo|vgg)\s*[-/]?\s*$/i;

/** Ordinal suffixes: "1st place" is a rank, not a measured quantity. */
const ORDINAL_SUFFIX = /^(?:st|nd|rd|th)\b/i;

/**
 * A contact number: optional `+`, then digit groups joined by spaces, hyphens,
 * dots or parens. Matched BEFORE the general digit scan so it is consumed
 * whole.
 *
 * Measured: an invented header number "+63 912-345-678" was reported as four
 * separate ungrounded claims ('63', '912', '345', '678'). That is noise in the
 * log, and it padded the regeneration prompt with four meaningless entries that
 * diluted the three real percentage fabrications alongside them. A phone number
 * is one fact and either is or is not the candidate's, so it is one claim.
 *
 * The 7-digit floor is what separates a phone from a date range or a score
 * line: "10-15" and "3.58/4.00" stay well under it.
 */
const PHONE_RUN = /\+?\(?\d[\d\s().-]{5,}\d/g;

/** Digits only, for comparing two contact numbers written different ways. */
const PHONE_MIN_DIGITS = 7;

/**
 * True when a matched run really is contact-number shaped.
 *
 * Beyond the digit floor this demands a positive signal that the run is a
 * contact number rather than a list of figures that happen to sit next to each
 * other: a leading `+`, a parenthesised country/area code, or grouping by
 * hyphens or dots. Bare space-separated numbers ("912 345 678 records") are
 * left to the ordinary claim scanner, so prose cannot masquerade as a phone and
 * ground a fabricated one.
 */
function isPhoneShaped(run: string): boolean {
  const digits = run.replace(/\D/g, "");
  if (digits.length < PHONE_MIN_DIGITS) return false;
  // A decimal fraction is a measurement: "3.58" or "0.9514", never a phone.
  // Dots only read as phone grouping when every dotted group is 2+ digits.
  if (/\d\.\d/.test(run) && /\.\d(?!\d)/.test(run)) return false;
  return /^\+/.test(run) || /[()]/.test(run) || /\d[-.]\d/.test(run);
}

/**
 * Strip everything that is presentation rather than magnitude.
 *
 * The pool writes "700,000+" and the model writes "700000"; the pool writes
 * "3.58/4.00" and the model writes "3.58". Trailing zeros after a decimal
 * point are dropped so "2.0" and "2" compare equal, which also collapses the
 * version-number forms that survive the skip rules.
 */
export function normalizeNumber(value: string): string {
  const cleaned = value.replace(/[\\,+~\s]/g, "");
  // Trailing-zero trim only applies to a real decimal, never to "700000".
  return cleaned.includes(".")
    ? cleaned.replace(/0+$/, "").replace(/\.$/, "")
    : cleaned;
}

/**
 * Normalise the pool so its digit-runs line up with a normalised claim.
 *
 * Commas, `+`, `~` and backslashes are dropped exactly as `normalizeNumber`
 * drops them, so "700,000+" becomes "700000". Whitespace is replaced by a
 * space rather than deleted: deleting it would fuse neighbouring figures into
 * one run, and the candidate's own phone number "+63 999-106-2601" would then
 * stop grounding the "63" printed on their own résumé.
 */
function normalizePool(pool: string): string {
  return pool.replace(/[\\,+~]/g, "").replace(/\s+/g, " ");
}

/**
 * True when the character before a digit-run binds it to a word.
 *
 * "C++11", "ES6" and "utf8" are names; "by 15" is a claim. A digit glued to a
 * letter with no space is never a metric a recruiter would read as one.
 */
function isBoundToWord(before: string): boolean {
  return /[A-Za-z]$/.test(before) || /[A-Za-z][-/]$/.test(before);
}

/**
 * The `\resumeSubheading` date argument, blanked out.
 *
 * Dates are the largest single source of false positives: they are legitimately
 * reformatted ("Aug 2023 – Expected 2027" for "August 2023 -- Expected 2027")
 * and a reformat is not a fabricated claim. Four-digit years are skipped
 * globally, but a date argument can also hold "10/2023" or a bare "2020-24",
 * so the whole argument is removed before scanning.
 */
function blankSubheadingDates(body: string): string {
  // \resumeSubheading takes four brace groups; the 2nd and 4th are the
  // right-hand columns, which is where dates live in this template.
  return body.replace(
    /\\resumeSubheading((?:\s*\{[^{}]*\}){4})/g,
    (whole, args: string) => {
      let n = 0;
      const blanked = args.replace(/\{([^{}]*)\}/g, (g, inner: string) => {
        n += 1;
        return n === 2 || n === 4 ? `{${" ".repeat(inner.length)}}` : g;
      });
      return whole.replace(args, blanked);
    },
  );
}

/**
 * Everything from `\begin{document}` onward.
 *
 * The preamble is pure layout maths — `0.97\textwidth`, `-6pt`,
 * `[letterpaper,11pt]`, `\pdfgentounicode=1` — and scanning it produces
 * nothing but noise. A fragment with no `\begin{document}` is already a body.
 */
function documentBody(latex: string): string {
  const i = latex.indexOf("\\begin{document}");
  return i === -1 ? latex : latex.slice(i + "\\begin{document}".length);
}

/** Trimmed window around a match, for evidence in a finding. */
function contextAround(text: string, index: number, length: number): string {
  return text
    .slice(Math.max(0, index - 60), index + length + 60)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The bullet a figure sits in, as the user would read it — or, outside any
 * bullet (a header line, a summary paragraph), a window around the match.
 * A raw window inside a bullet read as "...18 months.} 
esumeItemListEnd"
 * in the metrics panel: LaTeX plumbing where the candidate's words belong.
 */
function contextFor(
  latex: string,
  bodyOffset: number,
  body: string,
  index: number,
  length: number,
): string {
  if (enclosingBullet(latex, bodyOffset + index).isItem) {
    return bulletTextAt(latex, bodyOffset + index);
  }
  return contextAround(body, index, length);
}

/**
 * Pull every quantitative claim out of a generated résumé's BODY.
 *
 * Only figures that read as achievements survive: layout lengths, years,
 * version tokens, ordinals and lone single digits are all filtered out here
 * rather than at the grounding step, so the caller never sees them.
 */
export function extractNumericClaims(latex: string): NumericClaim[] {
  return extractNumericClaimsAt(latex).map(({ at: _at, ...claim }) => claim);
}

/** A claim with its offset into the full source, for the strip. */
type PositionedClaim = NumericClaim & { at: number };

/** As `extractNumericClaims`, keeping each claim's position in `latex`. */
function extractNumericClaimsAt(latex: string): PositionedClaim[] {
  if (!latex?.trim()) return [];
  // Blanking preserves length, so a body offset maps straight back onto the
  // source by adding where the body starts.
  const bodyStart = latex.indexOf("\\begin{document}");
  const bodyOffset =
    bodyStart === -1 ? 0 : bodyStart + "\\begin{document}".length;
  const body = blankSubheadingDates(documentBody(latex));
  const out: PositionedClaim[] = [];

  // Contact numbers first, so a phone is consumed whole rather than shattered
  // into one claim per digit group. Each span is then invisible to the general
  // digit scan below.
  const phoneSpans: Array<[number, number]> = [];
  for (const pm of body.matchAll(PHONE_RUN)) {
    const run = pm[0].replace(/[\s.-]+$/, "");
    if (!isPhoneShaped(run)) continue;
    const start = pm.index;
    phoneSpans.push([start, start + run.length]);
    out.push({
      at: start,
      raw: run,
      // Digits only: the comparison for a contact number ignores formatting.
      value: run.replace(/\D/g, ""),
      context: contextFor(latex, bodyOffset, body, start, run.length),
    });
  }
  const inPhone = (i: number) => phoneSpans.some(([s, e]) => i >= s && i < e);

  // A digit-run with optional decimals, plus whatever percent marker follows.
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const digits = m[0];
    const start = m.index;
    if (inPhone(start)) continue;
    const before = body.slice(Math.max(0, start - 24), start);
    const after = body.slice(start + digits.length);

    // Percent, written any of the three ways a résumé writes it.
    const pct = /^\s*(?:\\%|%|\s*percent\b)/.exec(after);
    const raw = pct ? digits + pct[0].replace(/\s+$/, "") : digits;

    // --- skips, each one a measured class of false positive ---------------

    // A LaTeX length or size that survived into the body.
    if (LENGTH_UNITS.test(after.trimStart()) && !pct) continue;
    // \textwidth-style units may follow immediately with no space.
    if (/^\s*\\(?:text|line)(?:width|height)/.test(after)) continue;

    // An ordinal rank: "1st place", "2nd".
    if (ORDINAL_SUFFIX.test(after)) continue;

    // A year. Résumé dates are reformatted freely and are not claims.
    if (!pct && /^\d{4}$/.test(digits)) {
      const y = Number(digits);
      if (y >= 1900 && y <= 2099) continue;
    }

    // Bound to a preceding word ("C++11", "ES6", "utf8") — part of a name.
    if (isBoundToWord(before)) continue;

    // A known technology token with a space before its version ("OAuth 2.0").
    if (TECH_TOKENS.test(before)) continue;

    // Lone single digits are too noisy to be worth a finding unless the
    // author attached a percent to them ("cut cost 8\%" is a real claim).
    if (!pct && /^\d$/.test(digits)) continue;

    out.push({
      at: start,
      raw,
      value: normalizeNumber(digits),
      context: contextFor(latex, bodyOffset, body, start, raw.length),
    });
  }

  // Phones were gathered ahead of the digit scan; restore document order so a
  // caller can report findings top to bottom.
  return out
    .sort((a, b) => a.at - b.at)
    .map((c) => ({ ...c, at: c.at + bodyOffset }));
}

/**
 * True when the normalised pool contains `v` as a figure in its own right.
 *
 * A plain substring test is not enough, and the failure is not hypothetical:
 * the pool's "Cisco UGNAYAN 2030" would ground a fabricated "30", and "150K"
 * would ground a fabricated "15". A figure only counts as present when it is
 * not glued to further digits on either side — though a `/` or `.` boundary
 * still counts, so "3.58/4.00" grounds "3.58".
 */
function poolHasFigure(p: string, v: string): boolean {
  let from = 0;
  for (;;) {
    const i = p.indexOf(v, from);
    if (i === -1) return false;
    const before = p[i - 1];
    const after = p[i + v.length];
    const boundedLeft = before === undefined || !/[\d.]/.test(before);
    const boundedRight = after === undefined || !/\d/.test(after);
    if (boundedLeft && boundedRight) return true;
    from = i + 1;
  }
}

/**
 * True when the pool contains this exact contact number.
 *
 * Compared on digits alone, so "+63 999 106 2601" in the pool grounds
 * "+63-999-106-2601" in the résumé — a reformat is not a fabrication.
 *
 * Crucially this matches WHOLE phone-shaped tokens from the pool rather than
 * searching the pool's digits for a substring. Concatenating every digit in the
 * pool and running an `includes` would let a fabricated number be "grounded" by
 * digits that merely happen to sit next to each other across unrelated figures
 * — a GPA beside a headcount beside a year. An invented number must match a
 * real number the candidate actually listed, in full.
 */
function phoneIsGrounded(rawClaim: string, pool: string): boolean {
  const want = rawClaim.replace(/\D/g, "");
  if (want.length < PHONE_MIN_DIGITS) return false;
  for (const m of pool.match(PHONE_RUN) ?? []) {
    if (!isPhoneShaped(m)) continue;
    const have = m.replace(/\D/g, "");
    // Equal, or the same number with a country code on one side only.
    if (have === want) return true;
    if (have.length > want.length && have.endsWith(want)) return true;
    if (want.length > have.length && want.endsWith(have)) return true;
  }
  return false;
}

/**
 * Every complete figure in the normalised pool, as written.
 *
 * The truncation rule below must compare against WHOLE pool figures. Scanning
 * for a substring instead is what let "2030" ground a fabricated "30", so this
 * grabs each digit-run entire — including its fractional part — and lets the
 * caller decide whether a claim is a valid shortening of one.
 */
function poolFigures(p: string): string[] {
  return p.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * True when `claim` is `full` with precision dropped — truncated or rounded.
 *
 * Dropping precision cannot inflate a claim, so a less precise restatement of
 * a real figure is not an invention: a pool of "0.9514" genuinely supports
 * "0.951" and "0.95". Measured: the generator emitted "achieving 0.951 recall"
 * from a pool that says 0.9514, and reporting that real achievement as
 * fabricated burned a regeneration pass.
 *
 * DIRECTIONAL, and deliberately so. Adding precision the pool does not have IS
 * fabrication — a pool of "0.95" must never ground a claimed "0.9514", because
 * that invents two digits of accuracy the candidate never measured. So the
 * claim must be strictly shorter than the pool figure.
 *
 * Confined to claims carrying a fractional part. That gate is what stops this
 * rule from re-opening the integer-substring hole: "30" and "2030" are both
 * integers, so they never reach it.
 */
function isPrecisionDrop(claim: string, full: string): boolean {
  if (!claim.includes(".")) return false;
  if (claim.length >= full.length) return false;
  if (!full.includes(".")) return false;
  // A prefix is a truncation: 0.9514 -> 0.951.
  if (full.startsWith(claim)) return true;
  // Otherwise accept only a true rounding to the claim's own precision, so
  // 0.951 grounds a pool 0.9514 but 0.952 does not.
  const decimals = claim.split(".")[1]?.length ?? 0;
  const rounded = Number(full).toFixed(decimals);
  return normalizeNumber(rounded) === normalizeNumber(claim);
}

/**
 * True when `value` is a precision-dropped form of some figure in the pool.
 *
 * Tries the claim as written and, for the fraction/percent pairing, as its
 * hundredfold and hundredth — so a pool of "0.9514" grounds a claimed "95.1"
 * as well as "0.951".
 */
function groundedByPrecisionDrop(p: string, v: string): boolean {
  const figures = poolFigures(p);
  const n = Number(v);
  const candidates = [v];
  if (Number.isFinite(n) && n !== 0) {
    // The same fraction/percent equivalence the caller applies to exact hits.
    candidates.push(normalizeNumber(String(n / 100)));
    candidates.push(normalizeNumber(String(n * 100)));
  }
  return candidates.some((c) => figures.some((f) => isPrecisionDrop(c, f)));
}

/**
 * True when `value` is supported by something in the candidate's material.
 *
 * Both sides are stripped of commas, `+`, `~`, backslashes and whitespace, so
 * "700,000+" in the pool grounds "700000" in the output, and "3.58/4.00"
 * grounds "3.58". The comparison runs on digit-runs rather than tokens because
 * the pool is LaTeX: a figure can be glued to a macro or a unit.
 */
export function numberIsGrounded(value: string, pool: string): boolean {
  if (!value) return true; // nothing to ground
  if (!pool?.trim()) return false;
  const v = normalizeNumber(value);
  const p = normalizePool(pool);
  if (poolHasFigure(p, v)) return true;

  // A fraction rendered as a percentage, and the reverse. Measured: the pool
  // says "0.9514 recall" and a generator may write "95.14\% recall" — the same
  // achievement, so flagging it would be a false positive. Only applied to a
  // decimal fraction below 1, where the reading is unambiguous.
  const n = Number(v);
  if (Number.isFinite(n)) {
    if (n > 0 && n < 1 && v.includes(".")) {
      if (poolHasFigure(p, normalizeNumber(String(n * 100)))) return true;
    }
    if (n >= 1 && poolHasFigure(p, normalizeNumber(String(n / 100)))) {
      return true;
    }
  }

  // Last: the claim may be a less precise restatement of a real figure.
  return groundedByPrecisionDrop(p, v);
}

/**
 * The claims that the pool does NOT support.
 *
 * The output is the fabrication set: every entry is a figure on the generated
 * résumé with no counterpart in the candidate's material. Order follows the
 * document, so a caller can report them top to bottom.
 */
export function findUngroundedNumbers(
  latex: string,
  pool: string,
): NumericClaim[] {
  return findUngroundedNumbersAt(latex, pool).map(
    ({ at: _at, ...claim }) => claim,
  );
}

function findUngroundedNumbersAt(
  latex: string,
  pool: string,
): PositionedClaim[] {
  return extractNumericClaimsAt(latex).filter((c) =>
    // A contact number is grounded only by the same contact number, never by
    // arithmetic or by digits scattered across unrelated figures.
    isPhoneShaped(c.raw)
      ? !phoneIsGrounded(c.raw, pool)
      : !numberIsGrounded(c.value, pool),
  );
}

// ------------------------------------------------------------------ strip ----

/** A separator between header fields: `$|$`, `|`, `·`, a dash or a comma. */
const HEADER_SEP = String.raw`(?:\$\|\$|\\textbar|\||·|•|—|–|-|,)`;
const SEP_AFTER = new RegExp(String.raw`^\s*${HEADER_SEP}\s*`);
const SEP_BEFORE = new RegExp(String.raw`\s*${HEADER_SEP}\s*$`);

/** "by 15%", "to 95%", "from 60%": the preposition goes with the figure. */
const PCT_LEAD =
  /\s+(?:by|to|from|of|at)\s+(?:~|over|about|nearly|up to|roughly|approximately|around|more than|almost)?\s*$/i;

/** "a 15% reduction": the figure goes, the noun stays. */
const PCT_NOUN =
  /^\s+(?=(?:improvement|increase|reduction|boost|gain|uplift|decrease|drop|faster|lift|growth|rise|cut|speedup|savings?)\b)/i;

export type NumberStrip = {
  latex: string;
  /** Figures removed in code. */
  stripped: NumericClaim[];
  /** Figures still on the page: no removal rule applied safely. */
  residual: NumericClaim[];
};

/**
 * Remove the invented figures a removal rule can take out safely, in code.
 *
 * The retry is the model's chance to restate an achievement without its
 * invented figure. When it does not — measured: an invented header phone
 * survived a retry — the figure would otherwise ship. A phone number is the
 * single worst thing to ship, because a recruiter will dial it, so a
 * contact number is always removed along with its separator. A percentage
 * comes out where its clause survives without it: "boosting turnover by
 * 15\%" becomes "boosting turnover", "a 30\% reduction" becomes "a
 * reduction". Anything else is left in place and reported as residual
 * rather than mangled: a wrong deletion is a new kind of fabrication.
 */
export function stripUngroundedNumbers(
  latex: string,
  pool: string,
): NumberStrip {
  const claims = findUngroundedNumbersAt(latex, pool);
  if (!claims.length) return { latex, stripped: [], residual: [] };

  const stripped: NumericClaim[] = [];
  const residual: NumericClaim[] = [];
  let out = latex;

  // Right to left, so each deletion leaves earlier offsets intact.
  for (const c of [...claims].sort((a, b) => b.at - a.at)) {
    const { at, ...claim } = c;
    let start = at;
    let end = at + c.raw.length;
    const before = out.slice(0, start);
    const after = out.slice(end);

    let rule: RegExpExecArray | null = null;
    if (isPhoneShaped(c.raw)) {
      if ((rule = SEP_AFTER.exec(after))) end += rule[0].length;
      else if ((rule = SEP_BEFORE.exec(before))) start -= rule[0].length;
      // A phone with no separator is still removed, whole.
      rule ??= /./.exec("x");
    } else if (/(?:\\%|%|percent)$/.test(c.raw)) {
      if ((rule = PCT_LEAD.exec(before))) start -= rule[0].length;
      else if ((rule = PCT_NOUN.exec(after))) end += rule[0].length;
    }

    if (!rule) {
      residual.unshift(claim);
      continue;
    }

    // Close the seam: never leave a double space or a space before a comma.
    let head = out.slice(0, start);
    let tail = out.slice(end);
    if (/\s$/.test(head) && /^\s/.test(tail)) tail = tail.replace(/^\s+/, "");
    if (/\s$/.test(head) && /^[,.;:)]/.test(tail))
      head = head.replace(/\s+$/, "");
    out = head + tail;
    stripped.unshift(claim);
  }

  return { latex: out, stripped, residual };
}
