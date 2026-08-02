"use client";

import { useEffect, useState } from "react";

type Health = {
  provider: "ollama" | "anthropic";
  model: string;
  ok: boolean;
  detail: string;
};

/**
 * Footer with an accurate data-handling notice.
 *
 * This is deliberately driven by /api/health rather than hardcoded copy: the
 * privacy claim differs materially between backends (a local Ollama host keeps
 * résumé text on your own network; the Anthropic backend sends it to a third
 * party). Stating the wrong one would be a misleading privacy claim.
 */
export default function BackendFooter({ label }: { label?: string }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: Health) => {
        if (!cancelled) setHealth(d);
      })
      .catch(() => {
        /* Non-critical — fall back to provider-neutral copy. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const inference =
    health == null
      ? "Your résumé and job description are sent to the configured model backend for analysis and rewriting."
      : health.provider === "ollama"
        ? `Inference runs on your own Ollama host (${health.model}) — your résumé and job description stay on your network.`
        : `Your résumé and job description are sent to Anthropic (${health.model}) for analysis and rewriting.`;

  return (
    <footer className="mt-16 flex flex-col justify-between gap-3 border-t border-paper/10 pt-8 text-xs text-paper/40 md:mt-20 md:flex-row md:items-center">
      <span className="font-display text-sm italic text-paper/55">
        {label ?? "Resuitme"}
      </span>
      <span className="max-w-xl leading-relaxed md:text-right">
        {inference} To verify the one-page fit, the draft LaTeX is also compiled
        by an external rendering service. Nothing is stored on this server;
        profile data lives only in your browser&apos;s localStorage.
        {health && !health.ok && (
          <>
            {" "}
            <span className="text-orange-300">
              Model backend unavailable — {health.detail}
            </span>
          </>
        )}
      </span>
    </footer>
  );
}
