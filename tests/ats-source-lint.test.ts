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

describe("lintLatexForAts — compile validity: unescaped ampersand", () => {
  it("flags the measured \\resumeSubheading argument that failed to compile", () => {
    // The real string from the profile-input-kind fixture: \resumeSubheading
    // expands to a tabular*, but its ARGUMENT is tokenized at the call site
    // where no alignment is in scope, so this is a hard error.
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`\resumeSubheading
      {Acme Corp}{2024 -- Present}
      {Founder & Data Analyst}{Remote}`,
    );
    const f = lintLatexForAts(latex).find(
      (x) => x.id === "unescaped-ampersand",
    );
    expect(f?.severity).toBe("critical");
    expect(f?.fix).toContain("\\&");
    expect(f?.evidence).toContain("Founder & Data Analyst");
  });

  it("does not flag a legitimate & in a tabular row", () => {
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`\begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{\footnotesize Acme Corp} & \footnotesize 2024 \\
      \textit{\footnotesize Analyst} & \textit{\footnotesize Remote} \\
    \end{tabular*}`,
    );
    expect(ids(latex)).not.toContain("unescaped-ampersand");
  });

  it("does not flag an & inside an align environment", () => {
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`\begin{align}
      f(x) &= x^2 \\
    \end{align}`,
    );
    expect(ids(latex)).not.toContain("unescaped-ampersand");
  });

  it("does not flag an already-escaped \\&", () => {
    // The sample uses this shape: \textbf{Data Analysis \& ML:} ...
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`\textbf{Data Analysis \& ML:} Pandas, NumPy \\`,
    );
    expect(ids(latex)).not.toContain("unescaped-ampersand");
  });

  it("ignores a bare & that is commented out", () => {
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`% {Founder & Data Analyst}` + "\nBuilt things.",
    );
    expect(ids(latex)).not.toContain("unescaped-ampersand");
  });
});

describe("lintLatexForAts — compile validity: unbalanced braces", () => {
  it("flags the measured stray }} after an already-closed group", () => {
    // The real second defect: \small{\item{...}} followed by a further }}.
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`\small{\item{ Built a data pipeline. }}
}}`,
    );
    const f = lintLatexForAts(latex).find((x) => x.id === "unbalanced-braces");
    expect(f?.severity).toBe("critical");
    expect(f?.fix).toMatch(/remove the extra closing brace/i);
  });

  it("flags brace depth going negative", () => {
    const latex = CLEAN.replace("Built things.", "Built things.}");
    const f = lintLatexForAts(latex).find((x) => x.id === "unbalanced-braces");
    expect(f?.title).toMatch(/extra closing brace/i);
    expect(f?.detail).toMatch(/too many/i);
  });

  it("flags a group left unclosed at end of document", () => {
    const latex = CLEAN.replace("Built things.", String.raw`\textbf{Built`);
    const f = lintLatexForAts(latex).find((x) => x.id === "unbalanced-braces");
    expect(f?.severity).toBe("critical");
    expect(f?.title).toMatch(/unclosed/i);
  });

  it("does not flag balanced nested macros", () => {
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`\resumeItem{\textbf{Built} a \textit{fast}{ }pipeline}`,
    );
    expect(ids(latex)).not.toContain("unbalanced-braces");
  });

  it("does not flag escaped braces \\{ and \\}", () => {
    const latex = CLEAN.replace(
      "Built things.",
      String.raw`Wrote \texttt{\{"k": 1\}} to disk`,
    );
    expect(ids(latex)).not.toContain("unbalanced-braces");
  });

  it("ignores braces inside a verbatim block", () => {
    const latex = CLEAN.replace(
      "Built things.",
      "\\begin{verbatim}\n}}}\n\\end{verbatim}",
    );
    expect(ids(latex)).not.toContain("unbalanced-braces");
  });

  it("ignores an unbalanced brace that is commented out", () => {
    const latex = CLEAN.replace("Built things.", "Built things. % }}}");
    expect(ids(latex)).not.toContain("unbalanced-braces");
  });
});

describe("lintLatexForAts — compile rules do not fire on real documents", () => {
  // The correctness bar: a false "your résumé won't compile" on a résumé that
  // compiles fine is worse than missing one. These are all known-good sources.
  const COMPILE_IDS = ["unescaped-ampersand", "unbalanced-braces"];

  it("finds no compile problems in sampleresume.tex", () => {
    const found = ids(SAMPLE).filter((id) => COMPILE_IDS.includes(id));
    expect(found).toEqual([]);
  });

  it("finds no compile problems in any built-in template", () => {
    for (const t of Object.values(TEMPLATES)) {
      const found = ids(t.latex).filter((id) => COMPILE_IDS.includes(id));
      expect(found, `template "${t.id}"`).toEqual([]);
    }
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
