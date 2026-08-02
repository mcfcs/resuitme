// Provider-agnostic LLM layer.
//
// Two backends are supported and selected at runtime by LLM_PROVIDER:
//   - "ollama"    → a self-hosted Ollama server (default; no API cost)
//   - "anthropic" → the Claude API via @anthropic-ai/sdk
//
// Every route in this app talks to the model through completeText() /
// completeJson() so swapping backends is an env change, not a code change.
//
// The two providers differ in how structured output is requested:
//   - Anthropic takes the JSON Schema via output_config.format, and the schema's
//     `description` fields reach the model as part of that contract.
//   - Ollama constrains decoding with a GBNF grammar compiled from the schema,
//     which DROPS `description`. Those descriptions carry real instruction
//     weight here (scoring rubric hints, "union across sources", etc.), so for
//     Ollama we additionally inline the schema into the prompt. See
//     withSchemaInPrompt().

import type Anthropic from "@anthropic-ai/sdk";

export type Provider = "ollama" | "anthropic";

// "primary" is the heavy reasoning/authoring model (analyze, tailor, build).
// "fast" is for the mechanical, high-volume calls (polish, profile merge).
export type Tier = "primary" | "fast";

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type CompleteArgs = {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  tier?: Tier;
  temperature?: number;
  /** Allow provider-side extended reasoning where supported. */
  thinking?: boolean;
};

export type JsonArgs = CompleteArgs & {
  /** JSON Schema describing the expected object. */
  schema: object;
};

/** Carries an HTTP status so routes can pass a sensible code back to the client. */
export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

// ---------------------------------------------------------------- config ----

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function getProvider(): Provider {
  const raw = env("LLM_PROVIDER")?.toLowerCase();
  if (raw === "anthropic") return "anthropic";
  if (raw === "ollama") return "ollama";
  // Unset: prefer Ollama unless the only thing configured is an Anthropic key.
  if (env("OLLAMA_BASE_URL") || env("OLLAMA_MODEL")) return "ollama";
  return env("ANTHROPIC_API_KEY") ? "anthropic" : "ollama";
}

function ollamaBaseUrl(): string {
  return (env("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434").replace(
    /\/+$/,
    "",
  );
}

const ANTHROPIC_PRIMARY = env("ANTHROPIC_MODEL") ?? "claude-opus-4-7";
const ANTHROPIC_FAST = env("ANTHROPIC_MODEL_FAST") ?? "claude-haiku-4-5";

/**
 * Model id for a tier. Both Ollama tiers default to the SAME model on purpose:
 * a single resident model avoids evict/reload churn, which on a VRAM-tight box
 * costs far more wall-clock than the smaller model ever saves.
 */
export function modelFor(tier: Tier = "primary"): string {
  if (getProvider() === "anthropic") {
    return tier === "fast" ? ANTHROPIC_FAST : ANTHROPIC_PRIMARY;
  }
  const primary = env("OLLAMA_MODEL") ?? "gpt-oss:20b";
  return tier === "fast" ? (env("OLLAMA_MODEL_FAST") ?? primary) : primary;
}

/** Human-readable backend description, surfaced in the UI footer. */
export function backendLabel(): string {
  return getProvider() === "anthropic"
    ? `Anthropic ${ANTHROPIC_PRIMARY}`
    : `Ollama ${modelFor("primary")}`;
}

// Ollama's default context window is 4096 tokens and it SILENTLY truncates the
// oldest tokens beyond it. This app routinely sends 8k-15k tokens (résumé +
// JD + parsed profile), so an unset num_ctx would quietly drop the system
// prompt's rules. Always send it explicitly.
function numCtx(): number {
  const n = Number(env("OLLAMA_NUM_CTX"));
  return Number.isFinite(n) && n > 0 ? n : 32768;
}

function ollamaTimeoutMs(): number {
  const n = Number(env("OLLAMA_TIMEOUT_MS"));
  return Number.isFinite(n) && n > 0 ? n : 600_000;
}

function ollamaKeepAlive(): string {
  return env("OLLAMA_KEEP_ALIVE") ?? "30m";
}

/**
 * "true" / "false" force the model's reasoning mode; anything else (default)
 * omits the field so each model uses its own default. Forcing think:true on a
 * model without reasoning support makes Ollama reject the request outright.
 */
function ollamaThink(): boolean | undefined {
  const raw = env("OLLAMA_THINK")?.toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

// --------------------------------------------------------------- helpers ----

/** Strip ```-fences that models wrap around code/LaTeX/JSON despite instructions. */
export function stripCodeFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t
    .replace(/^```[a-zA-Z]*\r?\n?/, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * Remove inline reasoning blocks. Ollama normally routes reasoning to a
 * separate `message.thinking` field, but plenty of community GGUFs emit
 * <think>…</think> straight into the content instead.
 */
function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Best-effort JSON extraction — tolerates stray prose around the object. */
function parseJsonLoose<T>(raw: string): T {
  const text = stripCodeFences(stripThinkBlocks(raw));
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall back to the outermost {...} span.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T;
    }
    throw new LlmError(
      `Model returned invalid JSON. First 500 chars: ${text.slice(0, 500)}`,
    );
  }
}

/**
 * Append the schema to the final user message. Ollama's grammar-constrained
 * decoding guarantees the SHAPE but discards every `description`, so without
 * this the model never sees the per-field guidance the prompts rely on.
 */
function withSchemaInPrompt(
  messages: LlmMessage[],
  schema: object,
): LlmMessage[] {
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      out[i] = {
        ...out[i],
        content: `${out[i].content}

=== REQUIRED JSON SCHEMA (obey every field description) ===
${JSON.stringify(schema, null, 2)}

Respond with a single JSON object matching this schema. No prose outside the JSON.`,
      };
      return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------- ollama ----

type OllamaChatResponse = {
  message?: { content?: string; thinking?: string };
  error?: string;
};

async function ollamaChat(
  args: CompleteArgs & { schema?: object },
): Promise<string> {
  const base = ollamaBaseUrl();
  const url = `${base}/api/chat`;
  const model = modelFor(args.tier);

  const messages = args.schema
    ? withSchemaInPrompt(args.messages, args.schema)
    : args.messages;

  const think = args.thinking === false ? false : ollamaThink();

  const body: Record<string, unknown> = {
    model,
    stream: false,
    keep_alive: ollamaKeepAlive(),
    messages: [
      { role: "system", content: args.system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    options: {
      num_ctx: numCtx(),
      num_predict: args.maxTokens,
      temperature: args.temperature ?? 0.3,
    },
  };
  if (args.schema) body.format = args.schema;
  if (think !== undefined) body.think = think;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ollamaTimeoutMs());

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (controller.signal.aborted) {
      throw new LlmError(
        `Ollama request timed out after ${Math.round(ollamaTimeoutMs() / 1000)}s (model "${model}" at ${base}). ` +
          `Raise OLLAMA_TIMEOUT_MS, or use a smaller model — a model that overflows VRAM runs an order of magnitude slower.`,
        504,
      );
    }
    throw new LlmError(
      `Cannot reach Ollama at ${base} — ${msg}. Check the host is up and that it listens on the network ` +
        `(set OLLAMA_HOST=0.0.0.0 on the Ollama machine and allow port 11434 through its firewall).`,
      503,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    let detail = text.slice(0, 600);
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) detail = j.error;
    } catch {
      /* keep raw text */
    }
    if (res.status === 404) {
      throw new LlmError(
        `Ollama has no model named "${model}". Pull it on the Ollama host: \`ollama pull ${model}\`. (${detail})`,
        404,
      );
    }
    throw new LlmError(`Ollama error ${res.status}: ${detail}`, 502);
  }

  let data: OllamaChatResponse;
  try {
    data = JSON.parse(text) as OllamaChatResponse;
  } catch {
    throw new LlmError(
      `Ollama returned a non-JSON response: ${text.slice(0, 500)}`,
    );
  }
  if (data.error) throw new LlmError(`Ollama error: ${data.error}`);

  const content = stripThinkBlocks(data.message?.content ?? "");
  if (!content) {
    throw new LlmError(
      `Model "${model}" returned empty content. If it is a reasoning model that spent its whole budget thinking, ` +
        `raise max tokens or set OLLAMA_THINK=false.`,
    );
  }
  return content;
}

// ------------------------------------------------------------- anthropic ----

let anthropicClient: Anthropic | null = null;

async function getAnthropicClient(): Promise<Anthropic> {
  if (anthropicClient) return anthropicClient;
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new LlmError(
      "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Add it to .env.local, " +
        "or set LLM_PROVIDER=ollama to use a local model instead.",
      500,
    );
  }
  const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
  anthropicClient = new AnthropicSdk({ apiKey });
  return anthropicClient;
}

async function anthropicChat(
  args: CompleteArgs & { schema?: object },
): Promise<string> {
  const client = await getAnthropicClient();

  const req: Record<string, unknown> = {
    model: modelFor(args.tier),
    max_tokens: args.maxTokens,
    system: args.system,
    messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (args.thinking) req.thinking = { type: "adaptive" };
  if (args.schema) {
    req.output_config = {
      format: { type: "json_schema", schema: args.schema },
    };
  }

  // The SDK's typings track the published API surface; adaptive thinking and
  // output_config are passed through as-is.
  const response = await (
    client.messages.create as unknown as (
      body: Record<string, unknown>,
    ) => Promise<{ content: Array<{ type: string; text?: string }> }>
  )(req);

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new LlmError("Model returned no text content.");
  }
  return textBlock.text;
}

// ------------------------------------------------------------------ api -----

/** Free-form completion. Returns the model's text with code fences stripped. */
export async function completeText(args: CompleteArgs): Promise<string> {
  const raw =
    getProvider() === "anthropic"
      ? await anthropicChat(args)
      : await ollamaChat(args);
  return stripCodeFences(stripThinkBlocks(raw));
}

/** Schema-constrained completion. Returns the parsed object. */
export async function completeJson<T>(args: JsonArgs): Promise<T> {
  const raw =
    getProvider() === "anthropic"
      ? await anthropicChat(args)
      : await ollamaChat(args);
  return parseJsonLoose<T>(raw);
}

/** Map any thrown error onto an HTTP status + message for a route response. */
export function llmErrorResponse(err: unknown): {
  error: string;
  status: number;
} {
  if (err instanceof LlmError) return { error: err.message, status: err.status };
  const message = err instanceof Error ? err.message : "Unknown error";
  return { error: message, status: 500 };
}
