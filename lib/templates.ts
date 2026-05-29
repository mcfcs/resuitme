export type BuiltinTemplate = {
  id: string;
  name: string;
  description: string;
  latex: string;
};

// Classic 1-page CS résumé layout — clean preamble with custom \resume* macros,
// section order Summary → Education → Skills → Projects → Experience.
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

\end{document}
`;

export const TEMPLATES: Record<string, BuiltinTemplate> = {
  classic: {
    id: "classic",
    name: "Classic 1-page",
    description:
      "Clean ATS-friendly LaTeX layout. Sections: Summary → Education → Skills → Projects → Experience.",
    latex: CLASSIC_LATEX,
  },
};

export const DEFAULT_TEMPLATE_ID = "classic";

export function getTemplate(id: string = DEFAULT_TEMPLATE_ID): BuiltinTemplate {
  return TEMPLATES[id] ?? TEMPLATES[DEFAULT_TEMPLATE_ID];
}
