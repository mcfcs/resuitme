import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resuitme — Tailor your resume to any job",
  description:
    "Paste your LaTeX resume and a job description. Get a rating, a tailored rewrite, and a download-ready .tex file.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
