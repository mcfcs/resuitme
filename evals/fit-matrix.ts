// Fit matrix: does the analyzer notice when the candidate is applying outside
// their field?
//
// Run with: npm run eval -- --suite fit
//
// This is the eval the hand-written fixtures could not provide. Real postings
// are messier than anything I would write — vague requirements, boilerplate,
// inconsistent headings — and the corpus is stratified so a false negative and
// a false alarm are both visible:
//
//   match     ICT roles                  -> should be direct/adjacent
//   mismatch  HR / Marketing / Accounting -> should be unrelated
//   adjacent  Engineering / Design / Finance -> the hard middle, either is fine
//   generic   domain-agnostic internships -> no strong expectation
//
// NOT run in CI: one analyzer call per JD against a live model.

import { readFileSync } from "node:fs";
import type { Analysis } from "@/lib/types";

export type HarvestedJd = {
  id: string;
  source: string;
  stratum: "match" | "generic" | "mismatch" | "adjacent";
  title: string | null;
  company: string | null;
  classification: string | null;
  description: string;
};

export type FitCase = {
  id: string;
  stratum: HarvestedJd["stratum"];
  title: string;
  ok: boolean;
  ms: number;
  error?: string;
  score?: number;
  domainMatch?: string;
  seniorityMatch?: string;
  transferableCount?: number;
  disqualifyingCount?: number;
};

export function loadCorpus(path: string): HarvestedJd[] {
  return JSON.parse(readFileSync(path, "utf8")).harvested as HarvestedJd[];
}

/**
 * A stratum's verdict is "correct" when it matches what a careful human would
 * say. `adjacent` and `generic` deliberately accept a range: a marketing-
 * adjacent analytics internship is genuinely arguable, and scoring arguable
 * cases as failures would make the number meaningless.
 */
export function isCorrect(
  stratum: HarvestedJd["stratum"],
  domainMatch: string | undefined,
): boolean | null {
  if (!domainMatch) return null;
  switch (stratum) {
    case "match":
      return domainMatch === "direct" || domainMatch === "adjacent";
    case "mismatch":
      return domainMatch === "unrelated";
    case "adjacent":
    case "generic":
      return null; // no single right answer; reported but not scored
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function fitReport(cases: FitCase[], label: string): string {
  const ok = cases.filter((c) => c.ok);
  const lines: string[] = [];
  lines.push(
    `### Fit matrix: \`${label}\` — ${ok.length} real job descriptions`,
  );
  lines.push("");
  lines.push(
    "| Stratum | n | direct | adjacent | unrelated | correct | mean score |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");

  for (const stratum of ["match", "adjacent", "generic", "mismatch"] as const) {
    const group = ok.filter((c) => c.stratum === stratum);
    if (!group.length) continue;
    const count = (d: string) =>
      group.filter((c) => c.domainMatch === d).length;
    const judged = group
      .map((c) => isCorrect(stratum, c.domainMatch))
      .filter((v): v is boolean => v !== null);
    const correct = judged.length
      ? pct(judged.filter(Boolean).length / judged.length)
      : "—";
    const meanScore = Math.round(
      group.reduce((s, c) => s + (c.score ?? 0), 0) / group.length,
    );
    lines.push(
      `| ${stratum} | ${group.length} | ${count("direct")} | ${count("adjacent")} ` +
        `| ${count("unrelated")} | ${correct} | ${meanScore} |`,
    );
  }

  // The two numbers that matter, called out plainly.
  const mismatches = ok.filter((c) => c.stratum === "mismatch");
  const matches = ok.filter((c) => c.stratum === "match");
  const detection = mismatches.length
    ? pct(
        mismatches.filter((c) => c.domainMatch === "unrelated").length /
          mismatches.length,
      )
    : "—";
  const falseAlarm = matches.length
    ? pct(
        matches.filter((c) => c.domainMatch === "unrelated").length /
          matches.length,
      )
    : "—";

  lines.push("");
  lines.push(
    `- **Mismatch detection**: ${detection} of out-of-field roles flagged \`unrelated\``,
  );
  lines.push(
    `- **False alarms**: ${falseAlarm} of in-field roles wrongly flagged \`unrelated\``,
  );

  const withTransfer = ok.filter((c) => (c.transferableCount ?? 0) > 0).length;
  lines.push(
    `- **Transferable evidence** named on ${pct(withTransfer / Math.max(ok.length, 1))} of cases`,
  );

  const failed = cases.length - ok.length;
  if (failed) lines.push(`- ${failed} case${failed === 1 ? "" : "s"} errored`);

  return lines.join("\n");
}

export function toCase(
  jd: HarvestedJd,
  analysis: Analysis,
  ms: number,
): FitCase {
  return {
    id: jd.id,
    stratum: jd.stratum,
    title: jd.title ?? "(untitled)",
    ok: true,
    ms,
    score: analysis.score,
    domainMatch: analysis.fit?.domain_match,
    seniorityMatch: analysis.fit?.seniority_match,
    transferableCount: analysis.fit?.transferable?.length ?? 0,
    disqualifyingCount: analysis.fit?.disqualifying?.length ?? 0,
  };
}
