// Catch qualitative claims in a generated résumé that the candidate's own
// material does not support.
//
// The numeric check (lib/ats/number-check.ts) catches an invented QUANTITY.
// It cannot catch an invented QUALITY: "led a team", "at scale",
// "cross-functional", "5+ years of experience" pass every other gate because
// the surrounding words are the candidate's own — only the leadership, the
// scope, the seniority or the duration is fabricated. Those are exactly the
// claims an interviewer probes first, and exactly the ones the build prompt
// already forbids in rules 1 and 2. The model writes them anyway.
//
// DELIBERATELY NARROW. Four kinds of claim, each a short explicit list, each
// grounded by an explicit synonym map. Inferring equivalence is how false
// positives get built, and this module is CONSERVATIVE like its numeric
// sibling: telling someone their real leadership was invented is worse than
// missing one fabrication, so anything ambiguous counts as grounded. The
// tests pin this on sampleresume.tex, which describes real leadership
// ("1st Place, Team Leader" / "Led a 5-member team") and must produce zero
// findings.
//
// Grounding is document-level: a claim is grounded when its head term, or a
// listed synonym, appears anywhere in the candidate's pool. That misses a
// leadership verb transplanted from one item onto another, and accepts the
// miss on purpose — per-item grounding would flag legitimate rewording.
//
// SOFTENING. Each finding carries the bullet it sits in and what that bullet
// becomes when the claim is removed in code. That rewrite is the backstop
// behind /api/build's model retry: a prompt can only ask, so when the retry
// still carries a claim the route applies the rewrite itself. The rules are
// removal-only — a clause is deleted, or a leading verb is re-headed — and
// when no rule applies safely the whole bullet is dropped rather than left
// dishonest. A dropped bullet is reported so the user can put it back with
// their own words.
//
// Pure and dependency-free so it is unit-testable without a model.

import { normalizeForQuoteMatch } from "./quote-check";
import { visibleText } from "@/lib/latex";

export type ClaimKind = "leadership" | "scale" | "seniority" | "duration";

/** A qualitative claim found in generated output that the pool does not support. */
export type UngroundedClaim = {
  /** As it appeared in the source, e.g. "Led a team of 12 engineers to". */
  raw: string;
  kind: ClaimKind;
  /** The head term the finding turns on, e.g. "led". */
  trigger: string;
  /** Visible text of the bullet the claim sits in. */
  context: string;
  /**
   * The bullet after the code strip, as visible text — or null when no
   * removal rule applies safely and the bullet is dropped whole.
   */
  softened: string | null;
};

/** What the backstop changed, for the UI to offer back to the user. */
export type SoftenedClaim = {
  claim: string;
  kind: ClaimKind;
  /** The bullet as the model wrote it. */
  bullet: string;
  /** The bullet as shipped; null means it was removed. */
  replacement: string | null;
};

// ------------------------------------------------------------ patterns ----

/**
 * Leadership verbs. Past tense only: "lead" is also a noun and a title, and
 * "leading" is a common adjective ("leading indicator"); each of those would
 * be a false-positive source, and the past-tense verb is how a résumé bullet
 * makes the claim anyway.
 */
const LEADERSHIP_VERBS = [
  "led",
  "managed",
  "owned",
  "directed",
  "supervised",
  "headed",
  "mentored",
  "oversaw",
  "spearheaded",
] as const;

/**
 * What in the pool grounds each verb. Small and explicit. Words that are
 * common in an unrelated sense are left OUT even though they share a root:
 * "own" ("their own"), "direct" ("direct impact"), "head"/"heading" (a
 * section heading) would ground a claim the candidate never made.
 */
const LEADERSHIP_SYNONYMS: Record<(typeof LEADERSHIP_VERBS)[number], string[]> =
  {
    led: [
      "led",
      "lead",
      "leads",
      "leader",
      "leaders",
      "leadership",
      "spearheaded",
      "headed",
    ],
    managed: [
      "managed",
      "manage",
      "manages",
      "managing",
      "management",
      "manager",
    ],
    owned: ["owned", "owner", "owners", "ownership", "owning"],
    directed: ["directed", "directs", "directing", "director"],
    supervised: [
      "supervised",
      "supervise",
      "supervises",
      "supervising",
      "supervisor",
      "supervision",
    ],
    headed: ["headed", "led", "lead", "leader", "leadership"],
    mentored: ["mentored", "mentor", "mentors", "mentoring", "mentorship"],
    oversaw: ["oversaw", "oversee", "oversees", "overseeing", "oversight"],
    spearheaded: [
      "spearheaded",
      "spearhead",
      "spearheading",
      "led",
      "leader",
      "leadership",
    ],
  };

/**
 * Verbs whose object is people rather than work. "Contributed to junior
 * engineers" is not a sentence, so these cannot be re-headed; a bullet that
 * turns on them is dropped unless the "<verb> <people> to <do>" rule applies.
 */
const PEOPLE_VERBS = new Set(["mentored", "supervised"]);

/** Nouns that make "<verb> a ... to <do>" a team-leadership clause. */
const TEAM_NOUNS =
  "team|teams|engineers|developers|designers|analysts|interns|students|members|people|staff|group|squad|volunteers|contributors";

/** Scope claims. Written as [surface regex, grounding terms]. */
const SCALE_PATTERNS: Array<[RegExp, string[]]> = [
  [/\bat scale\b/gi, ["at scale", "large scale"]],
  [/\blarge[- ]scale\b/gi, ["large scale", "at scale"]],
  [/\benterprise(?:[- ](?:grade|level|scale|wide))?\b/gi, ["enterprise"]],
  [/\bhigh[- ]volume\b/gi, ["high volume"]],
  [/\bmission[- ]critical\b/gi, ["mission critical"]],
  [/\bproduction[- ](?:grade|ready)\b/gi, ["production"]],
  [
    /\bcompany[- ]wide\b/gi,
    ["company wide", "organisation wide", "organization wide"],
  ],
  [/\bcross[- ]functional(?:ly)?\b/gi, ["cross functional"]],
  [/\bindustry[- ]leading\b/gi, ["industry leading"]],
  [/\bworld[- ]class\b/gi, ["world class"]],
];

/** Title modifiers that assert a seniority the pool must contain. */
const TITLE_RE =
  /\b(senior|principal|staff|lead|chief|head)\s+(?:software\s+|data\s+|ml\s+|backend\s+|frontend\s+|full[- ]stack\s+)?(engineer|developer|scientist|analyst|architect|manager|designer|researcher)\b/gi;

/** "team of 12", "12-member team", "12-person team". */
const TEAM_SIZE_RE =
  /\b(?:team of (\d+)\b|(\d+)[- ](?:member|person|people|engineer|developer)s?\s+team\b)/gi;

const STAKEHOLDERS_RE = /\bstakeholders?\b/gi;
const DIRECT_REPORTS_RE = /\bdirect reports?\b/gi;

/**
 * Duration of experience, with or without a figure. "5+ years of experience"
 * needs the 5 and the years to sit together in the pool: a bare "5" anywhere
 * (a team size, a GPA) satisfies the numeric check and must not satisfy this.
 * "Years of experience" with no figure is still a duration claim.
 */
const DURATION_RE =
  /\b(?:(?:over|more than|nearly|almost)\s+)?(?:(\d+)\s*\+?\s*)?(?:years?|yrs)['’]?\s+(?:of\s+)?(?:professional\s+|hands[- ]on\s+|industry\s+|relevant\s+)?(?:experience|expertise)\b/gi;

// ------------------------------------------------------------ grounding ----

/** True when `term` appears as whole words in the normalised pool. */
function poolHasTerm(pool: string, term: string): boolean {
  return ` ${pool} `.includes(` ${normalizeForQuoteMatch(term)} `);
}

/** True when the pool has `n` and `word` in the same clause, either order. */
function poolHasNear(pool: string, n: string, word: string): boolean {
  const re = new RegExp(
    `(?:^|\\s)${n}(?:\\s\\S+){0,6}?\\s${word}s?(?:\\s|$)|(?:^|\\s)${word}s?(?:\\s\\S+){0,6}?\\s${n}(?:\\s|$)`,
  );
  return re.test(pool);
}

// ------------------------------------------------------------ scanning ----

type Found = {
  at: number;
  raw: string;
  kind: ClaimKind;
  trigger: string;
  grounded: (pool: string) => boolean;
};

/** Everything from `\begin{document}` onward; a fragment is already a body. */
function documentBody(latex: string): { body: string; offset: number } {
  const i = latex.indexOf("\\begin{document}");
  if (i === -1) return { body: latex, offset: 0 };
  const offset = i + "\\begin{document}".length;
  return { body: latex.slice(offset), offset };
}

function scan(body: string): Found[] {
  const out: Found[] = [];

  const verbRe = new RegExp(`\\b(${LEADERSHIP_VERBS.join("|")})\\b`, "gi");
  for (const m of body.matchAll(verbRe)) {
    const verb = m[1].toLowerCase() as (typeof LEADERSHIP_VERBS)[number];
    out.push({
      at: m.index,
      raw: m[0],
      kind: "leadership",
      trigger: verb,
      grounded: (pool) =>
        LEADERSHIP_SYNONYMS[verb].some((s) => poolHasTerm(pool, s)),
    });
  }

  for (const [re, terms] of SCALE_PATTERNS) {
    for (const m of body.matchAll(re)) {
      out.push({
        at: m.index,
        raw: m[0],
        kind: "scale",
        trigger: normalizeForQuoteMatch(m[0]),
        grounded: (pool) => terms.some((t) => poolHasTerm(pool, t)),
      });
    }
  }

  for (const m of body.matchAll(TITLE_RE)) {
    const modifier = m[1].toLowerCase();
    out.push({
      at: m.index,
      raw: m[0],
      kind: "seniority",
      trigger: modifier,
      grounded: (pool) => poolHasTerm(pool, modifier),
    });
  }

  for (const m of body.matchAll(TEAM_SIZE_RE)) {
    const n = m[1] ?? m[2];
    out.push({
      at: m.index,
      raw: m[0],
      kind: "seniority",
      trigger: `team of ${n}`,
      grounded: (pool) =>
        poolHasNear(pool, n, "team") ||
        poolHasNear(pool, n, "member") ||
        poolHasNear(pool, n, "person") ||
        poolHasNear(pool, n, "people"),
    });
  }

  for (const m of body.matchAll(STAKEHOLDERS_RE)) {
    out.push({
      at: m.index,
      raw: m[0],
      kind: "seniority",
      trigger: "stakeholders",
      grounded: (pool) =>
        poolHasTerm(pool, "stakeholder") || poolHasTerm(pool, "stakeholders"),
    });
  }

  for (const m of body.matchAll(DIRECT_REPORTS_RE)) {
    out.push({
      at: m.index,
      raw: m[0],
      kind: "seniority",
      trigger: "direct reports",
      grounded: (pool) =>
        poolHasTerm(pool, "direct report") ||
        poolHasTerm(pool, "direct reports"),
    });
  }

  for (const m of body.matchAll(DURATION_RE)) {
    const n = m[1];
    out.push({
      at: m.index,
      raw: m[0],
      kind: "duration",
      trigger: n ? `${n} years` : "years of experience",
      grounded: (pool) =>
        n
          ? poolHasNear(pool, n, "year")
          : poolHasTerm(pool, "years of experience") ||
            poolHasTerm(pool, "years experience") ||
            poolHasTerm(pool, "year of experience"),
    });
  }

  return out.sort((a, b) => a.at - b.at);
}

// -------------------------------------------------------------- bullets ----

type Span = {
  /** Start/end of the whole construct to delete when the bullet is dropped. */
  outerStart: number;
  outerEnd: number;
  /** Start/end of the editable text inside it. */
  innerStart: number;
  innerEnd: number;
};

/** Index just past the brace group opening at `open`, or -1 if unbalanced. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The bullet containing position `at`.
 *
 * Every built-in template writes bullets as `\resumeItem{...}`, so that is
 * the construct looked for first — with real brace matching, since a bullet
 * routinely contains `\textbf{...}`. A user's own LaTeX may use bare `\item`
 * lines; there the enclosing line is the bullet, which is also what the
 * summary paragraph resolves to.
 */
function enclosingBullet(s: string, at: number): Span {
  const macro = "\\resumeItem{";
  let from = 0;
  for (;;) {
    const i = s.indexOf(macro, from);
    if (i === -1 || i > at) break;
    const open = i + macro.length - 1;
    const close = matchBrace(s, open);
    if (close !== -1 && at >= open && at < close) {
      return {
        outerStart: i,
        outerEnd: close,
        innerStart: open + 1,
        innerEnd: close - 1,
      };
    }
    from = i + 1;
  }
  const lineStart = s.lastIndexOf("\n", at - 1) + 1;
  const nl = s.indexOf("\n", at);
  const lineEnd = nl === -1 ? s.length : nl;
  // A bare `\item` is the bullet marker, not the bullet: the text starts
  // after it, so a leading-verb rule sees the verb as leading.
  const marker = /^\s*\\item\s*/.exec(s.slice(lineStart, lineEnd));
  const innerStart = lineStart + (marker?.[0].length ?? 0);
  return {
    outerStart: lineStart,
    outerEnd: lineEnd,
    innerStart: Math.min(innerStart, at),
    innerEnd: lineEnd,
  };
}

// ------------------------------------------------------------ softening ----

const IRREGULAR_PAST: Record<string, string> = {
  build: "built",
  write: "wrote",
  run: "ran",
  drive: "drove",
  make: "made",
  lead: "led",
  set: "set",
  cut: "cut",
  bring: "brought",
  win: "won",
  teach: "taught",
  grow: "grew",
  take: "took",
  give: "gave",
  hold: "held",
  keep: "kept",
  stand: "stood",
};

/** Past tense of a bare verb, good enough for a bullet head. */
function pastTense(verb: string): string {
  const v = verb.toLowerCase();
  if (IRREGULAR_PAST[v]) return IRREGULAR_PAST[v];
  if (v.endsWith("e")) return `${v}d`;
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ied`;
  // Short consonant-vowel-consonant verbs double the last letter: ship,
  // plan, map. Longer ones do not: design, develop.
  if (v.length <= 4 && /[^aeiou][aeiou][^aeiouwxy]$/.test(v)) {
    return `${v}${v[v.length - 1]}ed`;
  }
  return `${v}ed`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Tidy the seams a deletion leaves behind. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*,/g, ",")
    .replace(/^\s*(?:and|with|for|to|,)\s+/i, "")
    .trim();
}

/** Below this, what is left of a bullet is not worth keeping. */
const MIN_BULLET_CHARS = 15;

/**
 * Remove one claim from the text of its bullet. Returns the new bullet text,
 * or null when no rule applies safely and the bullet must go.
 *
 * `rel` is the claim's offset within `text`.
 */
function softenOne(text: string, rel: number, f: Found): string | null {
  const before = text.slice(0, rel);
  const after = text.slice(rel + f.raw.length);
  const leading = before.trim() === "";

  switch (f.kind) {
    case "leadership": {
      const verb = f.trigger;
      // "<Verb> a 5-member team to design X" -> "Designed X". Only when a
      // team-ish noun sits between, so "Led migration to AWS" never becomes
      // "AWSed".
      // The verb may be wrapped in a macro (`to \textbf{build}`); the macro
      // is kept around the re-headed verb so its braces stay balanced.
      const toDo = new RegExp(
        `^\\s+(?:a|an|the|our|my|multiple|several|two|three|four|five|\\d+)?[^,;]{0,60}?\\b(?:${TEAM_NOUNS})\\b[^,;]{0,40}?\\s+to\\s+(\\\\[a-zA-Z]+\\{)?([a-z]+)\\b`,
      );
      const m = toDo.exec(after);
      if (m && leading) {
        const rest = after.slice(m[0].length);
        return `${m[1] ?? ""}${capitalize(pastTense(m[2]))}${rest}`;
      }
      if (PEOPLE_VERBS.has(verb)) return null;
      // "Led development of X" -> "Contributed to development of X".
      const head = leading ? "Contributed to" : "contributed to";
      return `${before}${head}${after}`;
    }

    case "scale": {
      // Delete the phrase and one adjacent space, whichever side has it.
      if (/^\s/.test(after)) return `${before}${after.replace(/^\s+/, "")}`;
      return `${before.replace(/\s+$/, "")}${after}`;
    }

    case "seniority": {
      if (f.trigger === "stakeholders" || f.trigger === "direct reports") {
        // "Presented findings to stakeholders" -> "Presented findings".
        const prep =
          /\s+(?:with|for|to|across|among|between|and)\s+(?:key\s+|internal\s+|external\s+|business\s+|senior\s+|cross-functional\s+|multiple\s+|\d+\s+)?$/i;
        if (prep.test(before)) return `${before.replace(prep, "")}${after}`;
        return null;
      }
      if (f.trigger.startsWith("team of ")) {
        // "a 12-member team" -> "a team"; "team of 12" -> "team".
        const n = f.trigger.slice("team of ".length);
        if (/^team of/i.test(f.raw)) return `${before}team${after}`;
        return `${before}team${after}`.replace(
          new RegExp(`\\b${n}[- ]\\S+\\s+team`),
          "team",
        );
      }
      // A title modifier: "Senior Engineer" -> "Engineer".
      const stripped = f.raw.replace(/^\S+\s+/, "");
      return `${before}${leading ? capitalize(stripped) : stripped}${after}`;
    }

    case "duration": {
      // "with 5+ years of experience building X" -> "with experience building X".
      const kept = f.raw.replace(
        /^(?:(?:over|more than|nearly|almost)\s+)?(?:\d+\s*\+?\s*)?(?:years?|yrs)['’]?\s+(?:of\s+)?/i,
        "",
      );
      return `${before}${leading ? capitalize(kept) : kept}${after}`;
    }
  }
}

// ------------------------------------------------------------------ api ----

/**
 * The qualitative claims that the pool does NOT support.
 *
 * Document order. Each finding carries the bullet it sits in and the bullet's
 * softened form, so a caller can report top to bottom and show exactly what
 * the backstop would change.
 */
export function findUngroundedClaims(
  latex: string,
  pool: string,
): UngroundedClaim[] {
  return plan(latex, pool).map((p) => ({
    raw: p.found.raw,
    kind: p.found.kind,
    trigger: p.found.trigger,
    context: visibleText(p.bulletText),
    softened: p.softenedBullet === null ? null : visibleText(p.softenedBullet),
  }));
}

type Planned = {
  found: Found;
  span: Span;
  bulletText: string;
  /** The bullet after ALL its claims are removed; null when dropped. */
  softenedBullet: string | null;
};

/** Every ungrounded claim, resolved to its bullet, with the group rewrite. */
function plan(latex: string, pool: string): Planned[] {
  if (!latex?.trim()) return [];
  const { body, offset } = documentBody(latex);
  const normPool = normalizeForQuoteMatch(pool ?? "");
  const found = scan(body).filter((f) => !f.grounded(normPool));
  if (!found.length) return [];

  // Group by bullet so a bullet with two claims is rewritten once, and the
  // rewrite of one claim cannot shift the other's offsets.
  const groups = new Map<number, { span: Span; items: Found[] }>();
  for (const f of found) {
    const span = enclosingBullet(latex, offset + f.at);
    const g = groups.get(span.innerStart) ?? { span, items: [] };
    g.items.push(f);
    groups.set(span.innerStart, g);
  }

  const out: Planned[] = [];
  for (const { span, items } of groups.values()) {
    const bulletText = latex.slice(span.innerStart, span.innerEnd);
    let text: string | null = bulletText;
    // Right to left, so each deletion leaves earlier offsets intact.
    for (const f of [...items].sort((a, b) => b.at - a.at)) {
      if (text === null) break;
      const rel = offset + f.at - span.innerStart;
      text = softenOne(text, rel, f);
    }
    if (text !== null) {
      text = tidy(text);
      if (visibleText(text).length < MIN_BULLET_CHARS) text = null;
      else text = capitalize(text);
    }
    for (const f of items) {
      out.push({ found: f, span, bulletText, softenedBullet: text });
    }
  }
  return out.sort((a, b) => a.found.at - b.found.at);
}

/**
 * Apply the code backstop: rewrite or drop every bullet carrying an
 * ungrounded claim, and return the result with a record of each change.
 *
 * An emptied bullet list is removed with its bullet, because
 * `\begin{itemize}\end{itemize}` is a LaTeX error and a dropped bullet must
 * never turn a compilable draft into one that does not compile.
 */
export function softenClaims(
  latex: string,
  pool: string,
): { latex: string; softened: SoftenedClaim[] } {
  const planned = plan(latex, pool);
  if (!planned.length) return { latex, softened: [] };

  // One edit per bullet, applied from the end of the document backwards.
  const edits = new Map<number, Planned>();
  for (const p of planned) edits.set(p.span.innerStart, p);
  const ordered = [...edits.values()].sort(
    (a, b) => b.span.innerStart - a.span.innerStart,
  );

  let out = latex;
  for (const p of ordered) {
    const { span } = p;
    if (p.softenedBullet === null) {
      // Take the trailing newline with the construct so no blank line is left.
      let end = span.outerEnd;
      if (out[end] === "\n") end += 1;
      out = out.slice(0, span.outerStart) + out.slice(end);
    } else {
      out =
        out.slice(0, span.innerStart) +
        p.softenedBullet +
        out.slice(span.innerEnd);
    }
  }

  out = out
    .replace(/\\resumeItemListStart\s*\\resumeItemListEnd/g, "")
    .replace(/\\begin\{itemize\}(?:\[[^\]]*\])?\s*\\end\{itemize\}/g, "");

  const softened: SoftenedClaim[] = planned.map((p) => ({
    claim: p.found.raw,
    kind: p.found.kind,
    bullet: visibleText(p.bulletText),
    replacement:
      p.softenedBullet === null ? null : visibleText(p.softenedBullet),
  }));

  return { latex: out, softened };
}
