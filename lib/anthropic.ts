import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Add it to .env.local at the project root.",
    );
  }
  cached = new Anthropic({ apiKey });
  return cached;
}

export const MODEL = "claude-opus-4-7";
export const MODEL_FAST = "claude-haiku-4-5";
