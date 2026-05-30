import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived HMAC tokens for the WebSocket $connect authorizer (Phase 2, T8).
 *
 * The Next.js server route mints a token (it holds the secret); the authorizer
 * λ verifies it. Both run server-side in Node — this module uses `node:crypto`
 * and is therefore **deliberately not re-exported from `index.ts`**, so it can
 * never end up in the browser bundle. Import it via `@f1/shared/ws-token`.
 *
 * Token format: `<expEpochSeconds>.<hex hmac-sha256 of that string>`. No PII,
 * no session binding — it's a cheap anti-abuse gate so random clients can't
 * open connections and rack up cost (Constitution IV + VII), not real auth.
 */

export const WS_TOKEN_TTL_SECONDS = 60;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Mint a token valid until `expEpochSeconds`. */
export function signWsToken(secret: string, expEpochSeconds: number): string {
  const exp = String(Math.floor(expEpochSeconds));
  return `${exp}.${sign(secret, exp)}`;
}

/** Convenience: mint a token valid for WS_TOKEN_TTL_SECONDS from `now`. */
export function mintWsToken(
  secret: string,
  now: Date = new Date(),
  ttlSeconds: number = WS_TOKEN_TTL_SECONDS,
): string {
  return signWsToken(secret, Math.floor(now.getTime() / 1000) + ttlSeconds);
}

export type WsTokenResult =
  | { valid: true }
  | { valid: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifyWsToken(
  secret: string,
  token: string | undefined,
  now: Date = new Date(),
): WsTokenResult {
  if (!token) return { valid: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0) return { valid: false, reason: "malformed" };

  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || !/^[0-9a-f]+$/.test(sig)) {
    return { valid: false, reason: "malformed" };
  }

  const expected = sign(secret, exp);
  // Constant-time compare; lengths must match for timingSafeEqual.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad-signature" };
  }

  if (Number(exp) <= Math.floor(now.getTime() / 1000)) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}
