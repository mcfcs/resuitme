import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeNumber,
  extractNumericClaims,
  numberIsGrounded,
  findUngroundedNumbers,
} from "@/lib/ats/number-check";

const POOL = readFileSync(
  fileURLToPath(new URL("../sampleresume.tex", import.meta.url)),
  "utf8",
);

/**
 * The exact source material behind the measured 15\%/30\% fabrication: an
 * e-commerce profile whose pricing line carries no figure at all.
 */
const PROFILE = [
  "Independent E-commerce Operator (Retail), Self-Employed.",
  "Operated a sneaker resale business across local and international",
  "marketplaces including StockX and Alias, coordinating sourcing,",
  "authentication, and cross-border logistics.",
  "Developed demand-based dynamic pricing strategies to maximize margins",
  "and inventory turnover.",
].join(" ");

/** Wrap a bullet in the minimum LaTeX needed for the body scanner to see it. */
function body(inner: string): string {
  return `\\begin{document}\n\\resumeItem{${inner}}\n\\end{document}`;
}

const values = (latex: string) =>
  extractNumericClaims(latex).map((c) => c.value);

describe("normalizeNumber", () => {
  it("strips thousands separators and approximation markers", () => {
    expect(normalizeNumber("700,000+")).toBe("700000");
    expect(normalizeNumber("~1,500")).toBe("1500");
  });

  it("drops trailing zeros so version-like decimals collapse", () => {
    expect(normalizeNumber("2.0")).toBe("2");
    expect(normalizeNumber("4.00")).toBe("4");
  });

  it("leaves a whole number's zeros alone", () => {
    // Only a decimal has meaningless trailing zeros; 700000 must not become 7.
    expect(normalizeNumber("700000")).toBe("700000");
  });

  it("keeps significant decimal digits", () => {
    expect(normalizeNumber("0.9514")).toBe("0.9514");
    expect(normalizeNumber("3.58")).toBe("3.58");
  });
});

describe("extractNumericClaims — only the body is scanned", () => {
  it("ignores preamble layout maths entirely", () => {
    const latex = [
      "\\documentclass[letterpaper,11pt]{article}",
      "\\addtolength{\\textwidth}{1in}",
      "\\vspace{-6pt}",
      "\\begin{tabular*}{0.97\\textwidth}",
      "\\begin{document}",
      "\\end{document}",
    ].join("\n");
    expect(extractNumericClaims(latex)).toEqual([]);
  });

  it("scans the whole string when there is no \\begin{document}", () => {
    // Callers pass bare fragments too; a fragment is already a body.
    expect(values("Cut onboarding time by 45\\%")).toContain("45");
  });

  it("returns nothing for empty input", () => {
    expect(extractNumericClaims("")).toEqual([]);
    expect(extractNumericClaims("   ")).toEqual([]);
  });

  it("records the raw form and surrounding context for evidence", () => {
    const [claim] = extractNumericClaims(
      body("boosting inventory turnover by 15\\%"),
    );
    expect(claim.raw).toBe("15\\%");
    expect(claim.value).toBe("15");
    expect(claim.context).toContain("inventory turnover");
  });
});

describe("extractNumericClaims — non-claims are skipped", () => {
  it("skips four-digit years", () => {
    expect(values(body("Ran the program from 2020 to 2027"))).toEqual([]);
  });

  it("skips a \\resumeSubheading date argument", () => {
    // Dates get reformatted legitimately; the whole argument is blanked, so
    // even non-year forms inside it are safe.
    const latex = [
      "\\begin{document}",
      "\\resumeSubheading",
      "  {Ateneo de Manila University}{Quezon City, PH}",
      "  {BS Computer Science}{Aug 2023 -- Expected 2027}",
      "\\end{document}",
    ].join("\n");
    expect(extractNumericClaims(latex)).toEqual([]);
  });

  it("skips a date range written as 2020-present", () => {
    expect(values(body("Independent operator, 2020-present"))).toEqual([]);
  });

  it("skips LaTeX lengths that survive into the body", () => {
    const latex = [
      "\\begin{document}",
      "\\begin{itemize}[leftmargin=0.15in, label={}]",
      "\\vspace{-2pt}",
      "\\begin{tabular*}{0.97\\textwidth}{l}",
      "\\end{document}",
    ].join("\n");
    expect(extractNumericClaims(latex)).toEqual([]);
  });

  it("skips version-like tech tokens separated by a space", () => {
    expect(values(body("Parsed e-receipts via OAuth 2.0"))).toEqual([]);
    expect(values(body("Built services in Python 3 and Web 3.0"))).toEqual([]);
  });

  it("skips digits bound to a preceding word with no space", () => {
    expect(values(body("Wrote C++11, ES6, and HTTP/2 clients"))).toEqual([]);
  });

  it("skips ordinals", () => {
    expect(values(body("1st Place, Team Leader"))).toEqual([]);
    expect(values(body("Finished 2nd out of the cohort"))).toEqual([]);
  });

  it("skips lone single digits as too noisy", () => {
    expect(values(body("Led a 5-member team"))).toEqual([]);
  });

  it("keeps a single digit when a percent is attached", () => {
    // "cut cost by 8\\%" is a real quantitative claim despite being one digit.
    expect(values(body("Cut hosting cost by 8\\%"))).toContain("8");
  });
});

describe("numberIsGrounded — real material is accepted", () => {
  it("accepts a figure quoted verbatim from the pool", () => {
    expect(numberIsGrounded("0.9514", POOL)).toBe(true);
  });

  it("accepts a comma-stripped form of a pool figure", () => {
    // Pool says "700,000+"; the model may write either form.
    expect(numberIsGrounded("700000", POOL)).toBe(true);
    expect(numberIsGrounded("700,000", POOL)).toBe(true);
  });

  it("accepts one side of a pool fraction", () => {
    // Pool says "GPA: 3.58/4.00".
    expect(numberIsGrounded("3.58", POOL)).toBe(true);
  });

  it("accepts a fraction rendered as a percentage and the reverse", () => {
    // Pool has "0.9514 recall"; a generator writing "95.14\\%" means the same
    // achievement, so flagging it would be a false positive.
    expect(numberIsGrounded("95.14", POOL)).toBe(true);
    expect(numberIsGrounded("0.9514", "achieved 95.14 percent recall")).toBe(
      true,
    );
  });

  it("accepts a figure that appears glued to a macro in the pool", () => {
    expect(numberIsGrounded("40", POOL)).toBe(true); // "within 40 epochs"
  });

  it("treats an empty value as grounded rather than inventing a finding", () => {
    expect(numberIsGrounded("", POOL)).toBe(true);
  });
});

describe("numberIsGrounded — invention is rejected", () => {
  it("rejects a figure absent from the pool", () => {
    expect(numberIsGrounded("15", PROFILE)).toBe(false);
    expect(numberIsGrounded("30", PROFILE)).toBe(false);
  });

  it("rejects an invented headcount", () => {
    expect(numberIsGrounded("12", POOL)).toBe(false);
  });

  it("does not let a longer pool figure ground a shorter fabrication", () => {
    // The pool's "UGNAYAN 2030" must not ground a fabricated "30", and its
    // "150K-resident" must not ground a fabricated "50".
    expect(numberIsGrounded("30", "Cisco UGNAYAN 2030 tools")).toBe(false);
    expect(numberIsGrounded("50", "a 150K-resident municipality")).toBe(false);
  });

  it("rejects everything when the pool is empty", () => {
    expect(numberIsGrounded("42", "")).toBe(false);
    expect(numberIsGrounded("42", "   ")).toBe(false);
  });
});

describe("numberIsGrounded — dropped precision is still the real figure", () => {
  // Measured in a live pipeline run: the pool says "0.9514 recall" and the
  // generator wrote "achieving 0.951 recall". Reporting that real achievement
  // as fabricated burned a regeneration pass.
  const RECALL =
    "Achieved 0.9514 recall on a class-imbalanced financial dataset";

  it("accepts a truncation of a real figure", () => {
    expect(numberIsGrounded("0.951", RECALL)).toBe(true);
    expect(numberIsGrounded("0.95", RECALL)).toBe(true);
  });

  it("accepts a dropped-precision figure restated as a percentage", () => {
    expect(numberIsGrounded("95.1", RECALL)).toBe(true);
    expect(numberIsGrounded("95", RECALL)).toBe(true);
  });

  it("accepts a genuine rounding, not only a prefix", () => {
    // 0.9549 rounds to 0.95 at the claim's own precision.
    expect(numberIsGrounded("0.95", "scored 0.9549 recall")).toBe(true);
  });

  it("rejects a decimal that merely shares a prefix but rounds differently", () => {
    expect(numberIsGrounded("0.952", RECALL)).toBe(false);
    expect(numberIsGrounded("0.96", RECALL)).toBe(false);
  });

  it("rejects ADDED precision, which is fabrication", () => {
    // The direction matters: inventing digits the candidate never measured is
    // exactly the thing this module exists to catch.
    expect(numberIsGrounded("0.9514", "scored 0.95 recall")).toBe(false);
    expect(numberIsGrounded("15.7", "cut processing by 15 days")).toBe(false);
  });

  it("keeps the integer-substring hole closed", () => {
    // The precision rule is gated to claims with a fractional part precisely
    // so integers can never reach it and revive the 2030/150K false negatives.
    expect(numberIsGrounded("30", "Led UGNAYAN 2030 outreach")).toBe(false);
    expect(numberIsGrounded("50", "Raised 150K in funding")).toBe(false);
    expect(numberIsGrounded("2", "over 2030 users")).toBe(false);
    expect(numberIsGrounded("203", "over 2030 users")).toBe(false);
  });

  it("does not treat an integer pool figure as droppable precision", () => {
    // "2500" has no fractional part to shorten, so it cannot ground "2.5".
    expect(numberIsGrounded("2.5", "over 2500 users")).toBe(false);
  });

  it("leaves the other grounding paths intact", () => {
    expect(numberIsGrounded("3.58", "GPA 3.58/4.00")).toBe(true);
    expect(numberIsGrounded("63", "+63 999-106-2601")).toBe(true);
    expect(numberIsGrounded("15", "cut processing from 10-15 days")).toBe(true);
  });
});

describe("findUngroundedNumbers — the measured inventory-turnover case", () => {
  // The real regression: the source line "Developed demand-based dynamic
  // pricing strategies to maximize margins and inventory turnover" contains no
  // figure, and the generator produced 15\% and 30\% out of nothing.
  const invented = body(
    "Developed demand-based dynamic pricing strategies, boosting inventory turnover by 15\\% and reducing manual audit time by 30\\%.",
  );

  it("flags both fabricated percentages", () => {
    const found = findUngroundedNumbers(invented, PROFILE);
    expect(found.map((c) => c.value)).toEqual(["15", "30"]);
  });

  it("carries the raw percent form and readable context", () => {
    const [first] = findUngroundedNumbers(invented, PROFILE);
    expect(first.raw).toBe("15\\%");
    expect(first.context).toContain("dynamic pricing");
  });

  it("flags an invented headcount in prose", () => {
    const found = findUngroundedNumbers(
      body("Led a team of 12 engineers"),
      POOL,
    );
    expect(found.map((c) => c.value)).toEqual(["12"]);
  });
});

describe("findUngroundedNumbers — grounded output is left alone", () => {
  it("passes a percent written as \\%, % or the word", () => {
    const pool = "Improved recall to 95% on the holdout set";
    expect(findUngroundedNumbers(body("reached 95\\% recall"), pool)).toEqual(
      [],
    );
    expect(findUngroundedNumbers(body("reached 95% recall"), pool)).toEqual([]);
    expect(
      findUngroundedNumbers(body("reached 95 percent recall"), pool),
    ).toEqual([]);
  });

  it("passes reformatted figures from the real résumé", () => {
    const regenerated = body(
      "Achieved 0.9514 recall within 40 epochs, scoring across 700000 clues on a 3.58 GPA.",
    );
    expect(findUngroundedNumbers(regenerated, POOL)).toEqual([]);
  });

  it("passes a whole regenerated résumé that only reformats the source", () => {
    // The strongest false-positive check available: the pool against itself.
    expect(findUngroundedNumbers(POOL, POOL)).toEqual([]);
  });

  it("returns nothing for empty or body-less input", () => {
    expect(findUngroundedNumbers("", POOL)).toEqual([]);
    expect(
      findUngroundedNumbers("\\begin{document}\\end{document}", POOL),
    ).toEqual([]);
  });
});

describe("contact numbers are one claim, not one per digit group", () => {
  // Measured: an invented header number was reported as four separate claims
  // ('63', '912', '345', '678'), padding the regeneration prompt with noise
  // that diluted the real percentage fabrications beside it.
  const CONTACT_POOL = "Gregorio Pascua, +63 999 106 2601, resale operator.";

  /** A résumé header carrying `phone`, plus three invented percentages. */
  const header = (phone: string) =>
    [
      "\\begin{document}",
      `\\small ${phone} $|$ a@b.com`,
      "\\resumeItem{Cut costs by 12\\% and time by 30\\%, raising margin 18\\%.}",
      "\\end{document}",
    ].join("\n");

  it("flags an invented phone as exactly one claim carrying the whole number", () => {
    const phones = findUngroundedNumbers(
      header("+63 912-345-678"),
      CONTACT_POOL,
    ).filter((c) => c.raw.includes("912"));
    expect(phones).toHaveLength(1);
    expect(phones[0].raw).toBe("+63 912-345-678");
  });

  it("grounds the candidate's real phone number when it is reformatted", () => {
    // Pool writes "+63 999 106 2601"; the résumé writes it with hyphens.
    const found = findUngroundedNumbers(
      "\\begin{document}\\small +63-999-106-2601\\end{document}",
      CONTACT_POOL,
    );
    expect(found).toEqual([]);
  });

  it("reports a phone plus two invented percentages as three claims", () => {
    const latex = [
      "\\begin{document}",
      "\\small +63 912-345-678 $|$ a@b.com",
      "\\resumeItem{Cut costs by 12\\% and time by 30\\%.}",
      "\\end{document}",
    ].join("\n");
    const found = findUngroundedNumbers(latex, CONTACT_POOL);
    expect(found.map((c) => c.raw)).toEqual([
      "+63 912-345-678",
      "12\\%",
      "30\\%",
    ]);
  });

  it("still detects each percentage individually alongside a phone", () => {
    const found = findUngroundedNumbers(
      header("+63 912-345-678"),
      CONTACT_POOL,
    );
    expect(found.map((c) => c.raw)).toEqual([
      "+63 912-345-678",
      "12\\%",
      "30\\%",
      "18\\%",
    ]);
  });

  it("treats a long unbroken digit run as a single claim", () => {
    const claims = extractNumericClaims(
      "\\begin{document}\\small 639991062601\\end{document}",
    );
    expect(claims.map((c) => c.raw)).toEqual(["639991062601"]);
  });

  it("does not let digits scattered across the pool ground a fake phone", () => {
    // This pool's concatenated digits literally contain "912345678", so a
    // digits-only substring test would wrongly call the fabrication grounded.
    const scattered = "GPA 3.58/4.00 across 912 records, 345 users, 678 runs.";
    const found = findUngroundedNumbers(
      "\\begin{document}\\small +63 912-345-678\\end{document}",
      scattered,
    );
    expect(found.map((c) => c.raw)).toEqual(["+63 912-345-678"]);
  });

  it("does not mistake grouped prose figures for a contact number", () => {
    // "912 345 678" with no +, parens or hyphen grouping is three figures.
    const claims = extractNumericClaims(
      "\\begin{document}counts: 912 345 678 across runs\\end{document}",
    );
    expect(claims.map((c) => c.raw)).toEqual(["912", "345", "678"]);
  });

  it("grounds a real number written with parens and dots", () => {
    expect(
      findUngroundedNumbers(
        "\\begin{document}\\small +63 999 106 2601\\end{document}",
        "reach me at (63) 999.106.2601 anytime",
      ),
    ).toEqual([]);
  });

  it("leaves dates, scores and comma figures out of phone handling", () => {
    // Each is under the 7-digit floor or carries a decimal fraction.
    expect(
      extractNumericClaims(
        "\\begin{document}from 10-15 days, GPA 3.58/4.00, 700,000+ clues\\end{document}",
      ).map((c) => c.raw),
    ).toEqual(["10", "15", "3.58", "4.00", "700,000"]);
  });
});

describe("regression guards for the earlier grounding rules", () => {
  it("keeps the truncated-decimal rule", () => {
    expect(
      numberIsGrounded("0.951", "Achieved 0.9514 recall on the dataset"),
    ).toBe(true);
  });

  it("keeps the integer-substring hole closed", () => {
    expect(numberIsGrounded("30", "Led UGNAYAN 2030 outreach")).toBe(false);
    expect(numberIsGrounded("50", "Raised 150K in funding")).toBe(false);
  });

  it("keeps fraction grounding", () => {
    expect(numberIsGrounded("3.58", "GPA 3.58/4.00")).toBe(true);
  });
});
