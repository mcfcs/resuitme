import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lintLatexForAts, isAtsClean } from "@/lib/ats/source-lint";
import { TEMPLATES } from "@/lib/templates";

const SAMPLE = readFileSync(
  fileURLToPath(new URL("../sampleresume.tex", import.meta.url)),
  "utf8",
);

const ids = (latex: string) => lintLatexForAts(latex).map((f) => f.id);

/** A minimal document that passes every rule, to isolate one rule at a time. */
const CLEAN = String.raw`\documentclass[letterpaper,11pt]{article}
\input{glyphtounicode}
\pdfgentounicode=1
\begin{document}
\section{Experience}
Built things.
\end{document}`;

describe("lintLatexForAts — baseline", () => {
  it("returns nothing for empty input", () => {
    expect(lintLatexForAts("")).toEqual([]);
  });

  it("reports no findings for a clean single-column document", () => {
    expect(lintLatexForAts(CLEAN)).toEqual([]);
  });

  it("orders findings critical first", () => {
    const messy = CLEAN.replace(
      "Built things.",
      String.raw`\includegraphics{x.png}` + "\n\\section{Vibes}",
    ).replace("\\pdfgentounicode=1", "");
    const sevs = lintLatexForAts(messy).map((f) => f.severity);
    expect(sevs[0]).toBe("critical");
    expect(sevs[sevs.length - 1]).toBe("info");
  });
});

describe("lintLatexForAts — the measured real documents", () => {
  it("passes the fixed sampleresume.tex with nothing critical", () => {
    // Measured: compiles to 1 page, zero bad glyphs in the extracted text.
    const findings = lintLatexForAts(SAMPLE);
    expect(isAtsClean(findings)).toBe(true);
  });

  it("would have flagged the peso sign before it was fixed", () => {
    // Regression guard for the one defect actually measured in the PDF.
    const withPeso = SAMPLE.replace("PHP 53M", "\u20b153M");
    expect(ids(withPeso)).toContain("risky-glyph");
  });

  it("passes every built-in template with nothing critical", () => {
    // Makes "our templates are ATS-clean" enforced rather than claimed.
    for (const t of Object.values(TEMPLATES)) {
      const findings = lintLatexForAts(t.latex);
      const critical = findings.filter((f) => f.severity === "critical");
      expect(
        critical,
        `template "${t.id}": ${critical.map((c) => c.title).join(", ")}`,
      ).toEqual([]);
    }
  });
});

describe("lintLatexForAts — two-column detection", () => {
  it("flags multicol as critical", () => {
    const latex = CLEAN.replace(
      "\\begin{document}",
      "\\usepackage{multicol}\n\\begin{document}\n\\begin{multicols}{2}",
    );
    const f = lintLatexForAts(latex).find((x) => x.id === "two-column");
    expect(f?.severity).toBe("critical");
    expect(f?.fix).toMatch(/single-column/i);
  });

  it("flags paracol as critical", () => {
    const latex = CLEAN.replace(
      "\\begin{document}",
      "\\usepackage{paracol}\n\\begin{document}",
    );
    expect(ids(latex)).toContain("two-column");
  });

  it("does not flag a single-column document", () => {
    expect(ids(CLEAN)).not.toContain("two-column");
  });
});

describe("lintLatexForAts — text-extraction mapping", () => {
  it("flags a missing glyphtounicode input", () => {
    expect(ids(CLEAN.replace("\\input{glyphtounicode}\n", ""))).toContain(
      "no-glyphtounicode",
    );
  });

  it("flags a missing pdfgentounicode", () => {
    expect(ids(CLEAN.replace("\\pdfgentounicode=1", ""))).toContain(
      "no-glyphtounicode",
    );
  });

  it("accepts the pair together", () => {
    expect(ids(CLEAN)).not.toContain("no-glyphtounicode");
  });
});

describe("lintLatexForAts — risky glyphs", () => {
  it("flags a C1 control character", () => {
    expect(ids(CLEAN.replace("Built things.", "Cut \u0091 costs"))).toContain(
      "risky-glyph",
    );
  });

  it("flags an exotic currency symbol", () => {
    expect(ids(CLEAN.replace("Built things.", "Raised \u20b95Cr"))).toContain(
      "risky-glyph",
    );
  });

  it("does not flag ordinary punctuation that extracts fine", () => {
    // Measured: en-dashes come through as U+2013 correctly.
    const latex = CLEAN.replace("Built things.", "Ran 10\u201315 experiments");
    expect(ids(latex)).not.toContain("risky-glyph");
  });
});

describe("lintLatexForAts — invisible content", () => {
  it("warns about includegraphics", () => {
    const f = lintLatexForAts(
      CLEAN.replace("Built things.", String.raw`\includegraphics{chart.png}`),
    ).find((x) => x.id === "image-content");
    expect(f?.severity).toBe("warning");
  });

  it("warns about tikz drawings", () => {
    const latex = CLEAN.replace(
      "Built things.",
      "\\begin{tikzpicture}\\end{tikzpicture}",
    );
    expect(ids(latex)).toContain("image-content");
  });

  it("warns about icon fonts", () => {
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`\faEnvelope me@x.com`,
    );
    expect(ids(latex)).toContain("icon-font");
  });
});

describe("lintLatexForAts — contact in a running header", () => {
  it("warns when the header carries contact details", () => {
    const latex = CLEAN.replace(
      "\\begin{document}",
      "\\fancyhead[L]{me@example.com}\n\\begin{document}",
    );
    expect(ids(latex)).toContain("contact-in-header");
  });

  it("stays quiet for a header with no contact details", () => {
    const latex = CLEAN.replace(
      "\\begin{document}",
      "\\fancyhead[L]{}\n\\begin{document}",
    );
    expect(ids(latex)).not.toContain("contact-in-header");
  });
});

describe("lintLatexForAts — section vocabulary", () => {
  it("accepts conventional headings", () => {
    for (const h of ["Experience", "Education", "Skills", "Projects"]) {
      const latex = CLEAN.replace("\\section{Experience}", `\\section{${h}}`);
      expect(ids(latex)).not.toContain("nonstandard-section");
    }
  });

  it("notes an unconventional heading as info only", () => {
    const latex = CLEAN.replace(
      "\\section{Experience}",
      "\\section{My Journey}",
    );
    const f = lintLatexForAts(latex).find(
      (x) => x.id === "nonstandard-section",
    );
    expect(f?.severity).toBe("info");
    expect(f?.title).toContain("My Journey");
  });

  it("accepts the sample's 'Extra-Curricular and Experience' heading", () => {
    expect(ids(SAMPLE)).not.toContain("nonstandard-section");
  });
});

describe("lintLatexForAts — comments are not code", () => {
  it("ignores a hostile construct that is commented out", () => {
    const latex = CLEAN.replace(
      "Built things.",
      "% \\begin{multicols}{2}\nBuilt things.",
    );
    expect(ids(latex)).not.toContain("two-column");
  });
});

describe("isAtsClean", () => {
  it("is true when only warnings and info are present", () => {
    expect(
      isAtsClean([{ id: "x", severity: "warning", title: "", detail: "" }]),
    ).toBe(true);
  });

  it("is false when anything critical is present", () => {
    expect(
      isAtsClean([{ id: "x", severity: "critical", title: "", detail: "" }]),
    ).toBe(false);
  });

  it("is true for no findings", () => {
    expect(isAtsClean([])).toBe(true);
  });
});
