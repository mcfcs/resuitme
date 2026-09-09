export type TemplateMacro = {
  /** Command name without the leading backslash, e.g. "resumeSubheading". */
  name: string;
  /** Argument names in order, used to show the model the call shape. */
  args: string[];
  purpose: string;
};

export type BuiltinTemplate = {
  id: string;
  name: string;
  description: string;
  latex: string;
  /**
   * Canonical top-level section order for THIS layout. Single source of truth:
   * it is injected into the generation prompts via the LAYOUT CONTRACT block
   * (lib/prompts/layout-contract.ts) instead of being restated in each prompt.
   */
  sectionOrder: string[];
  /** Sections that must never be dropped, however tight the budget. */
  requiredSections: string[];
  /** Sections this layout supports and may omit when there is no content. */
  optionalSections: string[];
  /** Layout macros the model must use verbatim rather than reinventing. */
  macros: TemplateMacro[];
  /** Placeholder strings that must not survive into generated output. */
  placeholders: string[];
  /**
   * Visible-char count for a comfortably full single page in this layout.
   * Denser layouts fit more. Measured with evals/measure-templates.ts, never
   * guessed — see that script's header.
   */
  targetChars: number;
};

// Classic 1-page CS résumé layout — clean preamble with custom \resume* macros,
// section order Summary → Education → Skills → Experience → Projects.
// Inline content is intentionally placeholder so the build model recognizes
// it as a starter to be filled, not as the candidate's real content.
const CLASSIC_LATEX = String.raw`\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\usepackage{amsmath}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}
\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-6pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-7pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-2pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{\footnotesize #1} & \footnotesize #2 \\
      \textit{\footnotesize #3} & \textit{\footnotesize #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \footnotesize #1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-6pt}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-7pt}}

\begin{document}

\begin{center}
    \textbf{\Huge \scshape Full Name} \\ \vspace{1pt}
    \small +country phone $|$
    \href{mailto:email@example.com}{\underline{email@example.com}} $|$
    \href{https://linkedin.com/in/handle}{\underline{linkedin.com/in/handle}} $|$
    \href{https://github.com/handle}{\underline{github.com/handle}}
\end{center}

\section{Summary}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     {One- to two-sentence professional summary describing the candidate's background and focus areas relevant to the role.} \\
}}
 \end{itemize}

\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Institution Name}{City, Country}
      {Degree Name, GPA: X.XX/4.00}{Start -- End or Expected Year}
    \resumeItemListStart
      \resumeItem{Relevant Coursework: course one, course two, course three, course four.}
      \resumeItem{Honors: list of academic honors.}
    \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
    \textbf{Programming:} languages, comma-separated \\
    \textbf{Category Two:} items, comma-separated \\
    \textbf{Category Three:} items, comma-separated \\
    \textbf{Category Four:} items, comma-separated
    }}
 \end{itemize}

\section{Experience}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Company or Organization}{Dates}
      {Role or Title}{Location}
      \resumeItemListStart
        \resumeItem{Bullet describing scope, responsibilities, and impact.}
        \resumeItem{Second bullet with a quantified outcome.}
      \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Projects}
    \resumeSubHeadingListStart
        \resumeProjectHeading
          {\textbf{Project Name} $|$ \emph{Tech Stack}}{}
          \resumeItemListStart
            \resumeItem{Bullet describing scope, what was built, and impact.}
            \resumeItem{Second bullet with a measurable outcome or technical detail.}
          \resumeItemListEnd

        \resumeProjectHeading
          {\textbf{Project Name} $|$ \emph{Tech Stack}}{}
          \resumeItemListStart
            \resumeItem{Bullet describing scope, what was built, and impact.}
            \resumeItem{Second bullet with a measurable outcome or technical detail.}
          \resumeItemListEnd
    \resumeSubHeadingListEnd

\end{document}
`;

// Denser sibling of Classic: 10pt with wider margins and tighter leading, same
// single-column structure and the same macro call shapes. Measured against
// identical content, the body occupies 615pt of vertical space where Classic
// needs 700pt — ~12% more content on one page. This is the only lever that
// fits more WITHOUT cutting anything, which is the app's main failure mode.
const COMPACT_LATEX = String.raw`\documentclass[letterpaper,10pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage[usenames,dvipsnames]{color}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\usepackage{amsmath}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.65in}
\addtolength{\evensidemargin}{-0.65in}
\addtolength{\textwidth}{1.3in}
\addtolength{\topmargin}{-.65in}
\addtolength{\textheight}{1.3in}
\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-8pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-9pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-3pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-3pt}\item
    \begin{tabular*}{0.98\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{\small #1} & \small #2 \\
      \textit{\footnotesize #3} & \textit{\footnotesize #4} \\
    \end{tabular*}\vspace{-8pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.98\textwidth}{l@{\extracolsep{\fill}}r}
      \small #1 & #2 \\
    \end{tabular*}\vspace{-8pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-7pt}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.12in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}[leftmargin=0.16in]}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-8pt}}

\begin{document}

\begin{center}
    \textbf{\Large \scshape Full Name} \\ \vspace{1pt}
    \footnotesize +country phone $|$
    \href{mailto:email@example.com}{\underline{email@example.com}} $|$
    \href{https://linkedin.com/in/handle}{\underline{linkedin.com/in/handle}} $|$
    \href{https://github.com/handle}{\underline{github.com/handle}}
\end{center}

\section{Summary}
 \begin{itemize}[leftmargin=0.12in, label={}]
    \small{\item{
     {One- to two-sentence professional summary describing the candidate's background and focus areas relevant to the role.} \\
}}
 \end{itemize}

\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Institution Name}{City, Country}
      {Degree Name, GPA: X.XX/4.00}{Start -- End or Expected Year}
    \resumeItemListStart
      \resumeItem{Relevant Coursework: course one, course two, course three, course four.}
      \resumeItem{Honors: list of academic honors.}
    \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Skills}
 \begin{itemize}[leftmargin=0.12in, label={}]
    \small{\item{
    \textbf{Programming:} languages, comma-separated \\
    \textbf{Category Two:} items, comma-separated \\
    \textbf{Category Three:} items, comma-separated \\
    \textbf{Category Four:} items, comma-separated
    }}
 \end{itemize}

\section{Experience}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Company or Organization}{Dates}
      {Role or Title}{Location}
      \resumeItemListStart
        \resumeItem{Bullet describing scope, responsibilities, and impact.}
        \resumeItem{Second bullet with a quantified outcome.}
      \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Projects}
    \resumeSubHeadingListStart
        \resumeProjectHeading
          {\textbf{Project Name} $|$ \emph{Tech Stack}}{}
          \resumeItemListStart
            \resumeItem{Bullet describing scope, what was built, and impact.}
            \resumeItem{Second bullet with a measurable outcome or technical detail.}
          \resumeItemListEnd

        \resumeProjectHeading
          {\textbf{Project Name} $|$ \emph{Tech Stack}}{}
          \resumeItemListStart
            \resumeItem{Bullet describing scope, what was built, and impact.}
            \resumeItem{Second bullet with a measurable outcome or technical detail.}
          \resumeItemListEnd
    \resumeSubHeadingListEnd

\end{document}
`;

// Education-first layout for research and graduate applications. Surfaces
// Publications and Awards as real sections — data ParsedProfile already carries
// (awards[], publications[]) but which the five-section canon could only fold
// away or drop. This is the layout that makes per-template sectionOrder earn
// its keep rather than being a hypothetical.
const ACADEMIC_LATEX = String.raw`\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage[usenames,dvipsnames]{color}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\usepackage{amsmath}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1.0in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}
\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-8pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-9pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-3pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-3pt}\item
    \begin{tabular*}{0.98\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{\small #1} & \small #2 \\
      \textit{\footnotesize #3} & \textit{\footnotesize #4} \\
    \end{tabular*}\vspace{-8pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.98\textwidth}{l@{\extracolsep{\fill}}r}
      \small #1 & #2 \\
    \end{tabular*}\vspace{-8pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-7pt}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.12in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}[leftmargin=0.16in]}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-8pt}}

\begin{document}

\begin{center}
    \textbf{\Huge \scshape Full Name} \ \vspace{1pt}
    \small +country phone $|$
    \href{mailto:email@example.com}{\underline{email@example.com}} $|$
    \href{https://linkedin.com/in/handle}{\underline{linkedin.com/in/handle}} $|$
    \href{https://github.com/handle}{\underline{github.com/handle}}
\end{center}

\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Institution Name}{City, Country}
      {Degree Name, GPA: X.XX/4.00}{Start -- End or Expected Year}
    \resumeItemListStart
      \resumeItem{Thesis or research focus, advisor if relevant.}
      \resumeItem{Relevant Coursework: course one, course two, course three.}
      \resumeItem{Honors: list of academic honors.}
    \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Research Experience}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Company or Organization}{Dates}
      {Role or Title}{Location}
      \resumeItemListStart
        \resumeItem{Bullet describing the research question, method, and result.}
        \resumeItem{Second bullet with a quantified outcome.}
      \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Publications}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
    1. Author list. Publication Title. Venue, Year. \
    2. Author list. Publication Title. Venue, Year.
    }}
 \end{itemize}

\section{Projects}
    \resumeSubHeadingListStart
        \resumeProjectHeading
          {\textbf{Project Name} $|$ \emph{Tech Stack}}{}
          \resumeItemListStart
            \resumeItem{Bullet describing scope, what was built, and impact.}
          \resumeItemListEnd
    \resumeSubHeadingListEnd

\section{Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
    \textbf{Programming:} languages, comma-separated \
    \textbf{Category Two:} items, comma-separated \
    \textbf{Category Three:} items, comma-separated
    }}
 \end{itemize}

\section{Awards}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
    Award Name, Awarding Body, Year. \
    Award Name, Awarding Body, Year.
    }}
 \end{itemize}

\end{document}
`;

export const TEMPLATES: Record<string, BuiltinTemplate> = {
  classic: {
    id: "classic",
    name: "Classic 1-page",
    description:
      "Single-column LaTeX layout with full-width sections. Verified to score 100/100 on the ATS text-extraction check.",
    latex: CLASSIC_LATEX,
    sectionOrder: ["Summary", "Education", "Skills", "Experience", "Projects"],
    requiredSections: ["Summary", "Education"],
    optionalSections: ["Skills", "Experience", "Projects"],
    macros: [
      {
        name: "resumeSubheading",
        args: ["organization", "dates", "role", "location"],
        purpose: "One experience or education entry's heading block.",
      },
      {
        name: "resumeProjectHeading",
        args: ["title with tech stack", "right-hand text (may be empty)"],
        purpose: "One project's heading line.",
      },
      {
        name: "resumeItem",
        args: ["bullet text"],
        purpose: "A single bullet under an entry.",
      },
      {
        name: "resumeSubHeadingListStart / resumeSubHeadingListEnd",
        args: [],
        purpose: "Wraps the list of entries in a section.",
      },
      {
        name: "resumeItemListStart / resumeItemListEnd",
        args: [],
        purpose: "Wraps the bullets under one entry.",
      },
    ],
    placeholders: [
      "Full Name",
      "email@example.com",
      "Institution Name",
      "Degree Name",
      "Company or Organization",
      "Project Name",
      "Tech Stack",
      "Bullet describing scope",
      "Category Two",
    ],
    // The real résumé in this layout measures 3,865 visible chars and compiles
    // to exactly one page, so a full page is ~3,900. Kept at the previously
    // calibrated 3,600 as a deliberately conservative compose target.
    targetChars: 3600,
  },

  compact: {
    id: "compact",
    name: "Compact 1-page",
    description:
      "Denser single-column layout at 10pt. Fits roughly 12% more content on one page than Classic, with the same ATS-safe structure.",
    latex: COMPACT_LATEX,
    sectionOrder: ["Summary", "Education", "Skills", "Experience", "Projects"],
    requiredSections: ["Summary", "Education"],
    optionalSections: ["Skills", "Experience", "Projects"],
    macros: [
      {
        name: "resumeSubheading",
        args: ["organization", "dates", "role", "location"],
        purpose: "One experience or education entry's heading block.",
      },
      {
        name: "resumeProjectHeading",
        args: ["title with tech stack", "right-hand text (may be empty)"],
        purpose: "One project's heading line.",
      },
      {
        name: "resumeItem",
        args: ["bullet text"],
        purpose: "A single bullet under an entry.",
      },
      {
        name: "resumeSubHeadingListStart / resumeSubHeadingListEnd",
        args: [],
        purpose: "Wraps the list of entries in a section.",
      },
      {
        name: "resumeItemListStart / resumeItemListEnd",
        args: [],
        purpose: "Wraps the bullets under one entry.",
      },
    ],
    placeholders: [
      "Full Name",
      "email@example.com",
      "Institution Name",
      "Degree Name",
      "Company or Organization",
      "Project Name",
      "Tech Stack",
      "Bullet describing scope",
      "Category Two",
    ],
    // Classic fits ~3,900 visible chars in 700pt of body height; this layout
    // renders the same content in 615pt, so capacity scales to ~4,400. Held at
    // 4,100 as a conservative compose target, mirroring Classic's margin.
    targetChars: 4100,
  },

  academic: {
    id: "academic",
    name: "Academic / research",
    description:
      "Education-first single-column layout with real Publications and Awards sections. Suited to research, graduate and fellowship applications.",
    latex: ACADEMIC_LATEX,
    sectionOrder: [
      "Education",
      "Research Experience",
      "Publications",
      "Projects",
      "Skills",
      "Awards",
    ],
    requiredSections: ["Education"],
    optionalSections: [
      "Research Experience",
      "Publications",
      "Projects",
      "Skills",
      "Awards",
    ],
    macros: [
      {
        name: "resumeSubheading",
        args: ["organization", "dates", "role", "location"],
        purpose: "One experience or education entry's heading block.",
      },
      {
        name: "resumeProjectHeading",
        args: ["title with tech stack", "right-hand text (may be empty)"],
        purpose: "One project's heading line.",
      },
      {
        name: "resumeItem",
        args: ["bullet text"],
        purpose: "A single bullet under an entry.",
      },
      {
        name: "resumeSubHeadingListStart / resumeSubHeadingListEnd",
        args: [],
        purpose: "Wraps the list of entries in a section.",
      },
      {
        name: "resumeItemListStart / resumeItemListEnd",
        args: [],
        purpose: "Wraps the bullets under one entry.",
      },
    ],
    placeholders: [
      "Full Name",
      "email@example.com",
      "Institution Name",
      "Degree Name",
      "Company or Organization",
      "Project Name",
      "Tech Stack",
      "Bullet describing scope",
      "Category Two",
    ],
    // Same 11pt body metrics as Classic, so the same capacity.
    targetChars: 3600,
  },
};

export const DEFAULT_TEMPLATE_ID = "classic";

export function getTemplate(id: string = DEFAULT_TEMPLATE_ID): BuiltinTemplate {
  return TEMPLATES[id] ?? TEMPLATES[DEFAULT_TEMPLATE_ID];
}
