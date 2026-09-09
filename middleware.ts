// Access control for /api/*.
//
// WHY THIS EXISTS: the README tells users to run `next dev -H 0.0.0.0` so they
// can use the app from their phone. The moment that happens, two routes become
// open proxies to anything else on the network:
//   - /api/render  -> a third-party LaTeX compile service (and it ships the
//                     user's résumé there)
//   - /api/analyze -> the user's GPU, which is a free, slow, expensive resource
//
// Two independent, optional guards:
//
//  1. A shared secret (APP_ACCESS_TOKEN). NO-OP WHEN UNSET, so the default
//     localhost-only experience is unchanged and nobody is locked out of their
//     own app by an upgrade. When set, every /api/* request must present it.
//  2. A per-IP rate limit on the two expensive routes. Always on — it costs
//     nothing when you are the only caller, and it bounds the damage if the
//     port is exposed without a token.
//
// This is a deterrent sized to a home LAN, not authentication. Anything
// genuinely public belongs behind a real reverse proxy with TLS.

import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const config = {
  matcher: "/api/:path*",
};

/** Routes worth limiting: each one costs real money, GPU time, or both. */
const LIMITS: Array<{ prefix: string; limit: number; windowMs: number }> = [
  // Model calls. A full tailor run is several sequential passes, so the
  // ceiling has to accommodate one user working normally.
  { prefix: "/api/analyze", limit: 30, windowMs: 60_000 },
  // Third-party compile service — this leaves the user's network.
  { prefix: "/api/render", limit: 60, windowMs: 60_000 },
];

function envToken(): string | undefined {
  const v = process.env.APP_ACCESS_TOKEN;
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Length-constant-ish comparison. Not a real timing-safe primitive (Edge
 * runtime has no crypto.timingSafeEqual), but it avoids the trivial
 * early-return leak of `===` on strings of differing content.
 */
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Accept either `x-app-token: <t>` or `authorization: Bearer <t>`. */
function presentedToken(req: NextRequest): string | undefined {
  const direct = req.headers.get("x-app-token");
  if (direct?.trim()) return direct.trim();
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  return undefined;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ---- 1. Shared secret, when configured -----------------------------------
  const expected = envToken();
  if (expected) {
    const provided = presentedToken(req);
    if (!provided || !tokenMatches(provided, expected)) {
      return NextResponse.json(
        {
          error:
            "Unauthorized. This instance requires an access token — send it as " +
            "the x-app-token header (or Authorization: Bearer). See " +
            "APP_ACCESS_TOKEN in .env.local.example.",
        },
        { status: 401 },
      );
    }
  }

  // ---- 2. Per-IP rate limit on the expensive routes ------------------------
  const rule = LIMITS.find((r) => pathname.startsWith(r.prefix));
  if (rule) {
    const ip = clientIp(req.headers);
    const result = rateLimit(`${rule.prefix}:${ip}`, rule.limit, rule.windowMs);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded for ${rule.prefix}. Try again in ${result.retryAfter}s.`,
        },
        {
          status: 429,
          headers: {
            "retry-after": String(result.retryAfter),
            "x-ratelimit-limit": String(result.limit),
            "x-ratelimit-remaining": "0",
          },
        },
      );
    }
    const res = NextResponse.next();
    res.headers.set("x-ratelimit-limit", String(result.limit));
    res.headers.set("x-ratelimit-remaining", String(result.remaining));
    return res;
  }

  return NextResponse.next();
}
