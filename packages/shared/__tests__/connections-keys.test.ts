import { describe, expect, it } from "vitest";

import {
  CONNECTION_TTL_SECONDS,
  connMetaSK,
  connPK,
  connTtlEpochSeconds,
} from "../src/connections-keys.js";

describe("F1Connections key helpers", () => {
  it("constructs PK with the conn# prefix", () => {
    expect(connPK("abc123=")).toBe("conn#abc123=");
  });

  it("meta SK is a stable single token", () => {
    expect(connMetaSK()).toBe("meta");
  });

  it("TTL is 2h ahead of the given clock", () => {
    const now = new Date("2026-05-24T20:00:00.000Z");
    expect(connTtlEpochSeconds(now)).toBe(
      Math.floor(now.getTime() / 1000) + CONNECTION_TTL_SECONDS,
    );
    expect(CONNECTION_TTL_SECONDS).toBe(7200);
  });
});
