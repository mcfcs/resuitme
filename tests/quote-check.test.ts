import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  quoteIsGrounded,
  normalizeForQuoteMatch,
  filterGroundedAdditions,
  MIN_QUOTE_CHARS,
} from "@/lib/ats/quote-check";

const POOL = readFileSync(
  fileURLToPath(new URL("../sampleresume.tex", import.meta.url)),
  "utf8",
);

describe("normalizeForQuoteMatch", () => {
  it("strips LaTeX commands so prose can match its source", () => {
    expect(normalizeForQuoteMatch("\\resumeItem{Built a thing}")).toBe(
      "built a thing",
    );
  });

  it("collapses punctuation and case", () => {
    expect(normalizeForQuoteMatch("USD-to-PHP, currency  conversion.")).toBe(
      "usd to php currency conversion",
    );
  });

  it("keeps characters that carry meaning in tech names", () => {
    expect(normalizeForQuoteMatch("C++ and C#")).toBe("c++ and c#");
  });
});

describe("quoteIsGrounded — real material is accepted", () => {
  it("accepts a verbatim quote", () => {
    expect(
      quoteIsGrounded(
        "Implemented FIFO inventory matching, USD-to-PHP currency conversion",
        POOL,
      ),
    ).toBe(true);
  });

  it("accepts a quote the model wrapped in LaTeX macros", () => {
    expect(
      quoteIsGrounded(
        "\\resumeItem{Designed a custom neural network architecture using SERF activations}",
        POOL,
      ),
    ).toBe(true);
  });

  it("accepts a quote reflowed onto one line", () => {
    expect(
      quoteIsGrounded(
        "Achieved 0.9514 recall on loan approval detection",
        POOL,
      ),
    ).toBe(true);
  });

  it("accepts a distinctive partial phrase", () => {
    expect(
      quoteIsGrounded("constraint-based backtracking algorithm", POOL),
    ).toBe(true);
  });
});

describe("quoteIsGrounded — invention is rejected", () => {
  it("rejects a plausible but absent achievement", () => {
    expect(
      quoteIsGrounded(
        "Led a team of 12 engineers across three continents",
        POOL,
      ),
    ).toBe(false);
  });

  it("rejects a subtle fabrication that reuses real vocabulary", () => {
    // The dangerous case: real-sounding words, invented claim.
    expect(
      quoteIsGrounded(
        "Reduced infrastructure costs by 40% using Kubernetes autoscaling",
        POOL,
      ),
    ).toBe(false);
  });

  it("rejects a quote too short to prove anything", () => {
    expect(quoteIsGrounded("Python", POOL)).toBe(false);
    expect("Python".length).toBeLessThan(MIN_QUOTE_CHARS);
  });

  it("rejects an empty or missing quote", () => {
    expect(quoteIsGrounded("", POOL)).toBe(false);
    expect(quoteIsGrounded("   ", POOL)).toBe(false);
  });
});

describe("filterGroundedAdditions", () => {
  const real = {
    sourceQuote: "Implemented FIFO inventory matching, USD-to-PHP currency",
    instruction: "restore the aCount bullet",
  };
  const fake = {
    sourceQuote: "Managed a $2M cloud budget across four business units",
    instruction: "add budget ownership",
  };

  it("keeps grounded additions and drops invented ones", () => {
    const { grounded, dropped } = filterGroundedAdditions([real, fake], POOL);
    expect(grounded).toEqual([real]);
    expect(dropped).toEqual([fake]);
  });

  it("reports what was dropped rather than silently filtering", () => {
    // A planner that starts fabricating must be visible, not quietly cleaned up.
    const { dropped } = filterGroundedAdditions([fake, fake], POOL);
    expect(dropped).toHaveLength(2);
  });

  it("handles an empty or absent list", () => {
    expect(filterGroundedAdditions([], POOL)).toEqual({
      grounded: [],
      dropped: [],
    });
    expect(filterGroundedAdditions(undefined, POOL)).toEqual({
      grounded: [],
      dropped: [],
    });
  });

  it("drops everything when the pool is empty", () => {
    const { grounded, dropped } = filterGroundedAdditions([real], "");
    expect(grounded).toEqual([]);
    expect(dropped).toEqual([real]);
  });
});
