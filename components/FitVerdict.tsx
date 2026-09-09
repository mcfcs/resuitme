"use client";

// Tells the candidate when they are applying somewhere they do not belong.
//
// The analyzer could already score a fundamental mismatch below 35, but a score
// is not actionable — it conflates "weak but plausible" with "wrong
// profession", and nothing in the app ever branched on it. This surfaces the
// structured verdict instead.
//
// IT NEVER BLOCKS. The build button stays live underneath. A profile can
// under-describe someone, career-changers exist, and the analyzer is not
// infallible — so this informs the decision rather than making it.

import type { Accent, FitVerdict } from "@/lib/types";

export default function FitVerdictNotice({
  fit,
  accent = "marigold",
}: {
  fit: FitVerdict | undefined;
  accent?: Accent;
}) {
  // A direct match needs no warning, and a warning on every run trains people
  // to ignore it.
  if (!fit || (fit.domain_match === "direct" && !fit.disqualifying.length)) {
    return null;
  }

  const unrelated = fit.domain_match === "unrelated";
  const hasBlockers = fit.disqualifying.length > 0;
  const severe = unrelated || hasBlockers;

  const tone = severe
    ? "border-orange-500/40 bg-orange-500/[0.06]"
    : "border-paper/12 bg-ink-raised/40";
  const rule = accent === "sage" ? "border-sage-500/50" : "border-marigold/50";

  const headline = unrelated
    ? "This role is in a different field"
    : hasBlockers
      ? "Some requirements can't be met by rewriting"
      : "Adjacent field — worth framing carefully";

  return (
    <section className={`rounded-md border p-4 sm:p-5 ${tone}`}>
      <h3 className="font-display text-lg font-medium sm:text-xl">
        {headline}
      </h3>

      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-paper/70">
        {unrelated
          ? "A résumé can present your experience well, but it cannot make you a candidate in a field you have not worked in. You can still apply — just go in knowing that."
          : hasBlockers
            ? "These are facts about your background, not a presentation problem. Nothing this tool does will change them."
            : "Your background is close enough to be credible here, but it will read better if the overlap is made explicit."}
      </p>

      {fit.disqualifying.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-orange-200">
            Requirements you don&apos;t currently meet
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-paper/70">
            {fit.disqualifying.map((d) => (
              <li key={d} className="flex gap-2">
                <span aria-hidden className="text-orange-300/70">
                  —
                </span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fit.transferable.length > 0 && (
        <div className={`mt-4 border-l-2 pl-4 ${rule}`}>
          <p className="text-sm font-medium text-paper/85">
            What does carry over
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-paper/70">
            {fit.transferable.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="mt-2.5 text-xs leading-relaxed text-paper/50">
            The résumé will lead with these rather than imitating the vocabulary
            of a field you haven&apos;t worked in.
          </p>
        </div>
      )}

      {fit.seniority_match === "below" && (
        <p className="mt-4 text-sm text-paper/60">
          The role also asks for more experience than your profile shows.
        </p>
      )}
    </section>
  );
}
