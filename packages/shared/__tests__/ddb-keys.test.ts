import { describe, expect, it } from "vitest";

import {
  driverIntervalSK,
  driverPositionSK,
  lapSK,
  LIVE_TTL_SECONDS,
  metaSK,
  sessionPK,
  stintSK,
  ttlEpochSeconds,
  weatherSK,
} from "../src/ddb-keys.js";

describe("Single-Table key helpers", () => {
  it("constructs PK with the session# prefix", () => {
    expect(sessionPK("11291")).toBe("session#11291");
  });

  it("meta SK is a stable single token", () => {
    expect(metaSK()).toBe("meta");
  });

  it("driver position SK is deterministic per driver", () => {
    expect(driverPositionSK(44)).toBe("driver#44#position");
  });

  it("driver interval SK is deterministic per driver", () => {
    expect(driverIntervalSK(63)).toBe("driver#63#interval");
  });

  it("lap SK zero-pads lap_number to 4 digits for sort stability", () => {
    expect(lapSK(44, 7)).toBe("lap#44#0007");
    expect(lapSK(44, 42)).toBe("lap#44#0042");
    expect(lapSK(44, 999)).toBe("lap#44#0999");
  });

  it("stint SK zero-pads stint_number to 2 digits", () => {
    expect(stintSK(81, 3)).toBe("stint#81#03");
    expect(stintSK(81, 12)).toBe("stint#81#12");
  });

  it("weather SK is a single fixed key (overwrite-on-tick)", () => {
    expect(weatherSK()).toBe("weather#current");
  });
});

describe("TTL helper", () => {
  it("returns 'now + 24h' as epoch seconds", () => {
    const now = new Date("2026-05-24T20:00:00+00:00");
    const ttl = ttlEpochSeconds(now);
    const expected = Math.floor(now.getTime() / 1000) + LIVE_TTL_SECONDS;
    expect(ttl).toBe(expected);
  });

  it("LIVE_TTL_SECONDS is exactly 24 hours", () => {
    expect(LIVE_TTL_SECONDS).toBe(86400);
  });
});
