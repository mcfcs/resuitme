// Locate the résumé bullet a position in the LaTeX source belongs to.
//
// Shared by the numeric and qualitative honesty checks so that both report a
// finding against the same thing the user sees: the bullet. A raw 60-char
// window around a match was the first attempt, and in the metrics panel it
// read as "…turnover by 18% over 18 months.} \resumeItemListEnd \resumeSubhe" —
// LaTeX plumbing in a place meant for the candidate's words.
//
// Pure and dependency-free.

import { visibleText } from "@/lib/latex";

export type BulletSpan = {
  /** Start/end of the whole construct to delete when the bullet is dropped. */
  outerStart: number;
  outerEnd: number;
  /** Start/end of the editable text inside it. */
  innerStart: number;
  innerEnd: number;
  /** True when the position sat inside a `\resumeItem{...}`. */
  isItem: boolean;
};

/** Index just past the brace group opening at `open`, or -1 if unbalanced. */
export function matchBrace(s: string, open: number): number {
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
 * lines; there the enclosing line is the bullet, with the text starting after
 * the `\item` marker, which is also what a summary paragraph resolves to.
 */
export function enclosingBullet(s: string, at: number): BulletSpan {
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
        isItem: true,
      };
    }
    from = i + 1;
  }
  const lineStart = s.lastIndexOf("\n", at - 1) + 1;
  const nl = s.indexOf("\n", at);
  const lineEnd = nl === -1 ? s.length : nl;
  const marker = /^\s*\\item\s*/.exec(s.slice(lineStart, lineEnd));
  const innerStart = lineStart + (marker?.[0].length ?? 0);
  return {
    outerStart: lineStart,
    outerEnd: lineEnd,
    innerStart: Math.min(innerStart, at),
    innerEnd: lineEnd,
    isItem: false,
  };
}

/**
 * A LaTeX fragment as a person reads it: commands stripped, and the escaped
 * specials (`\%`, `\&`, `\_`, `\#`, `\$`) unescaped. `visibleText` leaves
 * those escapes in because it only estimates length; a finding shown to the
 * user must not read "15\%".
 */
export function readableText(fragment: string): string {
  // Adjacent macro arguments ("{Founder}{Philippines}") would otherwise fuse
  // into one word once the braces are stripped.
  return visibleText(fragment.replace(/\}\s*\{/g, "} {")).replace(
    /\\([%&_#$])/g,
    "$1",
  );
}

/** Readable text of the bullet containing `at`. */
export function bulletTextAt(s: string, at: number): string {
  const span = enclosingBullet(s, at);
  return readableText(s.slice(span.innerStart, span.innerEnd));
}
