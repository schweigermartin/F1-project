import { verifyWsToken } from "@f1/shared/ws-token";

/**
 * $connect authorizer logic. Pure DI — index.ts wires SSM + the policy shape.
 *
 * Two gates (Constitution VII), cheapest first:
 *   1. Origin must be on the allowlist (blocks third-party pages from opening
 *      connections at all).
 *   2. A short-lived HMAC token minted by our own Next.js server must verify
 *      (blocks scripted clients that aren't our frontend).
 *
 * This is anti-abuse for a public demo, not real auth — see ws-token.ts.
 */

export interface AuthorizeInput {
  origin?: string;
  token?: string;
}

export interface AuthorizeConfig {
  secret: string;
  allowedOrigins: string[];
  now: Date;
}

export interface AuthorizeResult {
  allow: boolean;
  reason: "ok" | "origin" | "malformed" | "bad-signature" | "expired";
}

/** Exact match, or a `*.suffix` wildcard entry (e.g. `https://*.vercel.app`). */
export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return false;
  return allowed.some((entry) => {
    const star = entry.indexOf("*");
    if (star === -1) return entry === origin;
    const prefix = entry.slice(0, star);
    const suffix = entry.slice(star + 1);
    return (
      origin.startsWith(prefix) && origin.endsWith(suffix) && origin.length >= entry.length - 1
    );
  });
}

export function authorizeConnect(input: AuthorizeInput, config: AuthorizeConfig): AuthorizeResult {
  if (!originAllowed(input.origin, config.allowedOrigins)) {
    return { allow: false, reason: "origin" };
  }
  const v = verifyWsToken(config.secret, input.token, config.now);
  if (!v.valid) return { allow: false, reason: v.reason };
  return { allow: true, reason: "ok" };
}
