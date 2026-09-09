import { describe, it, expect } from "vitest";
import {
  stripCodeFences,
  stripThinkBlocks,
  parseJsonLoose,
  LlmError,
} from "@/lib/llm";

describe("stripCodeFences", () => {
  it("passes through unfenced text unchanged (trimmed)", () => {
    expect(stripCodeFences("  hello  ")).toBe("hello");
  });

  it("strips a bare fence", () => {
    expect(stripCodeFences("```\nhello\n```")).toBe("hello");
  });

  it("strips a language-tagged fence", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips a latex-tagged fence, preserving backslashes", () => {
    expect(stripCodeFences("```latex\n\\section{Hi}\n```")).toBe(
      "\\section{Hi}",
    );
  });

  it("leaves text alone when the fence is not at the start", () => {
    // Only a leading fence is treated as a wrapper.
    const input = "Here you go:\n```\nbody\n```";
    expect(stripCodeFences(input)).toBe(input);
  });

  it("preserves interior fences of a fenced block", () => {
    const out = stripCodeFences("```md\nuse ```inline``` here\n```");
    expect(out).toContain("inline");
  });

  it("handles CRLF line endings after the opening fence", () => {
    expect(stripCodeFences("```json\r\n{}\r\n```")).toBe("{}");
  });

  it("returns empty string for empty input", () => {
    expect(stripCodeFences("")).toBe("");
  });

  it("does not damage LaTeX that merely contains braces", () => {
    const latex = "\\documentclass{article}\n\\begin{document}x\\end{document}";
    expect(stripCodeFences(latex)).toBe(latex);
  });
});

describe("stripThinkBlocks", () => {
  it("removes a single think block", () => {
    expect(stripThinkBlocks("<think>reasoning</think>answer")).toBe("answer");
  });

  it("removes a multi-line think block", () => {
    expect(
      stripThinkBlocks("<think>\nstep 1\nstep 2\n</think>\nfinal answer"),
    ).toBe("final answer");
  });

  it("removes multiple think blocks", () => {
    expect(stripThinkBlocks("<think>a</think>X<think>b</think>Y")).toBe("XY");
  });

  it("is case-insensitive", () => {
    expect(stripThinkBlocks("<THINK>a</THINK>done")).toBe("done");
  });

  it("leaves text without think blocks unchanged (trimmed)", () => {
    expect(stripThinkBlocks("  plain  ")).toBe("plain");
  });

  it("is non-greedy across separate blocks", () => {
    // A greedy match would swallow KEEP between the two blocks.
    expect(stripThinkBlocks("<think>1</think>KEEP<think>2</think>")).toBe(
      "KEEP",
    );
  });

  it("leaves an unterminated think block alone", () => {
    // No closing tag: nothing is removed, so the caller still sees the text
    // rather than silently losing the whole response.
    expect(stripThinkBlocks("<think>never closed")).toBe("<think>never closed");
  });

  it("returns empty string when the response is only reasoning", () => {
    expect(stripThinkBlocks("<think>all of it</think>")).toBe("");
  });
});

describe("parseJsonLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(parseJsonLoose<{ a: number }>('```json\n{"a":1}\n```')).toEqual({
      a: 1,
    });
  });

  it("parses JSON wrapped in a bare fence", () => {
    expect(parseJsonLoose<{ ok: boolean }>('```\n{"ok":true}\n```')).toEqual({
      ok: true,
    });
  });

  it("parses JSON preceded by a think block", () => {
    expect(
      parseJsonLoose<{ score: number }>(
        '<think>weighing the evidence</think>{"score":72}',
      ),
    ).toEqual({ score: 72 });
  });

  it("parses JSON that is both fenced and preceded by a think block", () => {
    expect(
      parseJsonLoose<{ score: number }>(
        '<think>hmm</think>\n```json\n{"score":80}\n```',
      ),
    ).toEqual({ score: 80 });
  });

  it("parses JSON with leading prose", () => {
    expect(
      parseJsonLoose<{ verdict: string }>(
        'Here is the evaluation you asked for:\n{"verdict":"strong fit"}',
      ),
    ).toEqual({ verdict: "strong fit" });
  });

  it("parses JSON with both leading and trailing prose", () => {
    expect(
      parseJsonLoose<{ a: number }>('Sure!\n{"a":1}\nHope that helps.'),
    ).toEqual({ a: 1 });
  });

  it("recovers the outermost object when prose surrounds nested objects", () => {
    const raw =
      'Result:\n{"keyword_coverage":{"present":["python"],"missing":[]}}\nDone.';
    expect(
      parseJsonLoose<{ keyword_coverage: { present: string[] } }>(raw)
        .keyword_coverage.present,
    ).toEqual(["python"]);
  });

  it("preserves nested structure and unicode", () => {
    const raw = '{"verdict":"résumé is strong","nested":{"deep":[1,2,3]}}';
    expect(parseJsonLoose<Record<string, unknown>>(raw)).toEqual({
      verdict: "résumé is strong",
      nested: { deep: [1, 2, 3] },
    });
  });

  it("throws LlmError on malformed input", () => {
    expect(() => parseJsonLoose("not json at all")).toThrow(LlmError);
  });

  it("throws LlmError on an empty response", () => {
    expect(() => parseJsonLoose("")).toThrow(LlmError);
  });

  it("throws LlmError when the response is only a think block", () => {
    expect(() => parseJsonLoose("<think>I never answered</think>")).toThrow(
      LlmError,
    );
  });

  it("throws on a truncated object rather than returning a partial", () => {
    // Braces are present but the span does not parse — must not be swallowed.
    expect(() => parseJsonLoose('{"a":1, "b":')).toThrow();
  });

  it("includes a snippet of the offending text in the error message", () => {
    try {
      parseJsonLoose("totally bogus payload");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).message).toContain("totally bogus payload");
    }
  });

  it("gives LlmError a 502 status by default", () => {
    try {
      parseJsonLoose("nope");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as LlmError).status).toBe(502);
    }
  });
});
