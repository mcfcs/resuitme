import { NextResponse } from "next/server";
import { getProvider, modelFor } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HealthResponse = {
  provider: "ollama" | "anthropic";
  model: string;
  modelFast: string;
  /** Backend reachable AND the configured model is available. */
  ok: boolean;
  /** Human-readable status, shown verbatim when something is wrong. */
  detail: string;
  /** Ollama only — models installed on the host. */
  available?: string[];
};

/**
 * Diagnostic endpoint. Visiting /api/health answers the two questions that
 * actually break a self-hosted setup: "can this server reach the model host?"
 * and "is the model I configured actually pulled there?"
 */
export async function GET() {
  const provider = getProvider();
  const model = modelFor("primary");
  const modelFast = modelFor("fast");

  if (provider === "anthropic") {
    const hasKey = !!process.env.ANTHROPIC_API_KEY?.trim();
    return NextResponse.json({
      provider,
      model,
      modelFast,
      ok: hasKey,
      detail: hasKey
        ? "Anthropic API key configured."
        : "ANTHROPIC_API_KEY is not set.",
    } satisfies HealthResponse);
  }

  const base = (
    process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
  ).replace(/\/+$/, "");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base}/api/tags`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({
        provider,
        model,
        modelFast,
        ok: false,
        detail: `Ollama at ${base} responded ${res.status}.`,
      } satisfies HealthResponse);
    }

    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const available = (data.models ?? []).map((m) => m.name);

    // Ollama resolves a bare name to its ":latest" tag, so compare both ways.
    const has = (want: string) =>
      available.some((a) => a === want || a === `${want}:latest`);

    const missing = [model, modelFast].filter((m) => !has(m));
    const uniqueMissing = Array.from(new Set(missing));

    return NextResponse.json({
      provider,
      model,
      modelFast,
      ok: uniqueMissing.length === 0,
      detail: uniqueMissing.length
        ? `Reachable, but not pulled on the host: ${uniqueMissing.join(", ")}. Run \`ollama pull ${uniqueMissing[0]}\` there.`
        : `Ollama reachable at ${base}; configured models are installed.`,
      available,
    } satisfies HealthResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      provider,
      model,
      modelFast,
      ok: false,
      detail:
        `Cannot reach Ollama at ${base} — ${msg}. On the Ollama machine set OLLAMA_HOST=0.0.0.0, ` +
        `restart Ollama, and allow TCP 11434 through its firewall.`,
    } satisfies HealthResponse);
  }
}
