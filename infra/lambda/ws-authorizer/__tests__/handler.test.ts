import { mintWsToken } from "@f1/shared/ws-token";
import { describe, expect, it } from "vitest";

import { authorizeConnect, originAllowed } from "../handler.js";

const SECRET = "test-secret";
const NOW = new Date("2026-05-24T20:00:00.000Z");
const ALLOWED = ["http://localhost:3000", "https://*.vercel.app"];

describe("originAllowed", () => {
  it("accepts an exact match and a wildcard suffix", () => {
    expect(originAllowed("http://localhost:3000", ALLOWED)).toBe(true);
    expect(originAllowed("https://f1-dash.vercel.app", ALLOWED)).toBe(true);
  });

  it("rejects unknown and look-alike origins, and a missing origin", () => {
    expect(originAllowed("https://evil.com", ALLOWED)).toBe(false);
    expect(originAllowed("https://evilvercel.app", ALLOWED)).toBe(false);
    expect(originAllowed(undefined, ALLOWED)).toBe(false);
  });
});

describe("authorizeConnect", () => {
  const cfg = { secret: SECRET, allowedOrigins: ALLOWED, now: NOW };

  it("allows a known origin with a valid token", () => {
    const token = mintWsToken(SECRET, NOW);
    expect(authorizeConnect({ origin: "http://localhost:3000", token }, cfg)).toEqual({
      allow: true,
      reason: "ok",
    });
  });

  it("denies a foreign origin before even checking the token", () => {
    const token = mintWsToken(SECRET, NOW);
    expect(authorizeConnect({ origin: "https://evil.com", token }, cfg)).toEqual({
      allow: false,
      reason: "origin",
    });
  });

  it("denies a known origin with a missing token", () => {
    expect(authorizeConnect({ origin: "http://localhost:3000" }, cfg)).toEqual({
      allow: false,
      reason: "malformed",
    });
  });

  it("denies a known origin with an expired token", () => {
    const token = mintWsToken(SECRET, new Date(NOW.getTime() - 120_000));
    expect(authorizeConnect({ origin: "http://localhost:3000", token }, cfg)).toEqual({
      allow: false,
      reason: "expired",
    });
  });
});
