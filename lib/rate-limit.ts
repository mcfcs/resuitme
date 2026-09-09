// In-memory, per-IP fixed-window rate limiter.
//
// SCOPE, honestly stated: this is a guard for the single-user local/LAN
// deployment this app is built for. State lives in one process's memory, so it
// resets on restart and does not coordinate across instances — it is not a
// defence against a distributed attacker. What it IS for: the README tells
// users to bind the dev server to 0.0.0.0 so their phone can reach it, and at
// that point /api/render is an open proxy to a third-party LaTeX compiler and
// /api/analyze is an open proxy to the user's GPU. This bounds the damage from
// anything else on that network finding the port.

export type RateLimitResult = {
  ok: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window resets. Only meaningful when ok is false. */
  retryAfter: number;
  limit: number;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Keys are evicted lazily on access. Without a cap, a host that sees many
// distinct source IPs would grow this map without bound.
const MAX_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Consume one request against `key`'s budget.
 *
 * Fixed window, not a sliding one: simpler, and the failure mode (up to 2x the
 * limit across a window boundary) does not matter for this threat model.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0, limit };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit,
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: limit - existing.count,
    retryAfter: 0,
    limit,
  };
}

/** Test seam — drops all recorded state. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Best-effort client IP.
 *
 * x-forwarded-for is client-controlled, so this is NOT a security boundary —
 * it only separates well-behaved clients from each other. The shared-secret
 * check in the middleware is what actually gates access.
 */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
