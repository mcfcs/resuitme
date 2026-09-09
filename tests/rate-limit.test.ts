import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimits, clientIp } from "@/lib/rate-limit";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows requests up to the limit", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", 3, 1000, 0).ok).toBe(true);
    }
  });

  it("blocks the request after the limit is reached", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 1000, 0);
    const r = rateLimit("k", 3, 1000, 0);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("counts down remaining", () => {
    expect(rateLimit("k", 3, 1000, 0).remaining).toBe(2);
    expect(rateLimit("k", 3, 1000, 0).remaining).toBe(1);
    expect(rateLimit("k", 3, 1000, 0).remaining).toBe(0);
  });

  it("keys are independent", () => {
    rateLimit("a", 1, 1000, 0);
    expect(rateLimit("a", 1, 1000, 0).ok).toBe(false);
    expect(rateLimit("b", 1, 1000, 0).ok).toBe(true);
  });

  it("resets after the window elapses", () => {
    rateLimit("k", 1, 1000, 0);
    expect(rateLimit("k", 1, 1000, 500).ok).toBe(false);
    // At exactly resetAt the window is over.
    expect(rateLimit("k", 1, 1000, 1000).ok).toBe(true);
  });

  it("reports a retryAfter of at least one second while blocked", () => {
    rateLimit("k", 1, 60_000, 0);
    const r = rateLimit("k", 1, 60_000, 0);
    expect(r.retryAfter).toBe(60);

    const late = rateLimit("k", 1, 60_000, 59_900);
    expect(late.ok).toBe(false);
    expect(late.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("reports retryAfter 0 while allowed", () => {
    expect(rateLimit("k", 5, 1000, 0).retryAfter).toBe(0);
  });

  it("echoes the configured limit", () => {
    expect(rateLimit("k", 7, 1000, 0).limit).toBe(7);
  });

  it("starts a fresh window rather than extending a blocked one", () => {
    // Exhaust, wait out the window, then confirm a full budget is available.
    rateLimit("k", 2, 1000, 0);
    rateLimit("k", 2, 1000, 0);
    expect(rateLimit("k", 2, 1000, 0).ok).toBe(false);

    expect(rateLimit("k", 2, 1000, 1001).ok).toBe(true);
    expect(rateLimit("k", 2, 1000, 1001).ok).toBe(true);
    expect(rateLimit("k", 2, 1000, 1001).ok).toBe(false);
  });

  it("handles a limit of one", () => {
    expect(rateLimit("k", 1, 1000, 0).ok).toBe(true);
    expect(rateLimit("k", 1, 1000, 0).ok).toBe(false);
  });
});

describe("clientIp", () => {
  it("uses the first entry of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIp(h)).toBe("1.2.3.4");
  });

  it("trims whitespace", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "  9.9.9.9  " }))).toBe(
      "9.9.9.9",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "10.0.0.1" }))).toBe("10.0.0.1");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    const h = new Headers({
      "x-forwarded-for": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
    });
    expect(clientIp(h)).toBe("1.1.1.1");
  });

  it("returns 'unknown' when no header is present", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("returns 'unknown' for an empty header rather than an empty key", () => {
    // An empty key would bucket every anonymous caller together silently;
    // "unknown" makes that explicit and is still a single shared bucket.
    expect(clientIp(new Headers({ "x-forwarded-for": "   " }))).toBe("unknown");
  });
});
