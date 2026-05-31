import { describe, expect, it } from "vitest";

import {
  driverIntervalSK,
  driverPositionSK,
  explanationSK,
  lapSK,
  LIVE_TTL_SECONDS,
  metaSK,
  predictionSK,
  racePK,
  sessionPK,
  skToEntity,
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

describe("skToEntity (inverse of the SK builders)", () => {
  it("maps every entity SK back to its kind", () => {
    expect(skToEntity(driverPositionSK(44))).toBe("position");
    expect(skToEntity(driverIntervalSK(44))).toBe("interval");
    expect(skToEntity(lapSK(44, 42))).toBe("lap");
    expect(skToEntity(stintSK(44, 3))).toBe("stint");
    expect(skToEntity(weatherSK())).toBe("weather");
  });

  it("returns null for meta and unknown SKs (not pushable as a delta)", () => {
    expect(skToEntity(metaSK())).toBeNull();
    expect(skToEntity("whatever#1")).toBeNull();
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

describe("F1Predictions key helpers (Phase 4)", () => {
  it("race PK groups all rows of one race, round zero-padded to 2 digits", () => {
    expect(racePK("2026-06-07", 9)).toBe("race#2026-06-07#09");
    expect(racePK("2026-11-22", 22)).toBe("race#2026-11-22#22");
  });

  it("prediction SK zero-pads the driver number for sort stability", () => {
    expect(predictionSK(1)).toBe("prediction#01");
    expect(predictionSK(44)).toBe("prediction#44");
  });

  it("explanation SK mirrors the prediction SK per driver", () => {
    expect(explanationSK(1)).toBe("explanation#01");
    expect(explanationSK(44)).toBe("explanation#44");
  });

  it("a race Query returns explanations before predictions (lexical SK order)", () => {
    expect(explanationSK(44) < predictionSK(44)).toBe(true);
  });

  it("padded SKs sort single- vs double-digit driver numbers correctly", () => {
    expect(predictionSK(2) < predictionSK(10)).toBe(true);
  });
});
