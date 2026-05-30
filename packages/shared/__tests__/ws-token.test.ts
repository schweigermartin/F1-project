import { describe, expect, it } from "vitest";

import { mintWsToken, signWsToken, verifyWsToken } from "../src/ws-token.js";

const SECRET = "super-secret-value";
const NOW = new Date("2026-05-24T20:00:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

describe("verifyWsToken", () => {
  it("accepts a freshly minted token", () => {
    const token = mintWsToken(SECRET, NOW);
    expect(verifyWsToken(SECRET, token, NOW)).toEqual({ valid: true });
  });

  it("rejects an expired token", () => {
    const token = signWsToken(SECRET, NOW_S - 1); // already expired at NOW
    expect(verifyWsToken(SECRET, token, NOW)).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintWsToken("other-secret", NOW);
    expect(verifyWsToken(SECRET, token, NOW)).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("rejects a tampered expiry (signature no longer matches)", () => {
    const token = mintWsToken(SECRET, NOW);
    const tampered = `${NOW_S + 9999}.${token.split(".")[1]}`;
    expect(verifyWsToken(SECRET, tampered, NOW)).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("rejects missing or malformed tokens", () => {
    expect(verifyWsToken(SECRET, undefined, NOW).valid).toBe(false);
    expect(verifyWsToken(SECRET, "", NOW)).toEqual({ valid: false, reason: "malformed" });
    expect(verifyWsToken(SECRET, "nodot", NOW)).toEqual({ valid: false, reason: "malformed" });
    expect(verifyWsToken(SECRET, "abc.def", NOW)).toEqual({ valid: false, reason: "malformed" });
  });
});
