import { describe, expect, it } from "vitest";

import {
  ENDPOINT_PAYLOAD_SCHEMAS,
  IntervalSchema,
  isSessionActive,
  LapSchema,
  PositionSchema,
  SessionSchema,
  StintSchema,
  WeatherSchema,
} from "../src/openf1-schema.js";

// Fixtures = real responses captured during the T1 spike (session_key=11291).
// Keeping them inline keeps the test file self-contained.

const sessionFixture = {
  session_key: 11291,
  session_type: "Race",
  session_name: "Race",
  date_start: "2026-05-24T20:00:00+00:00",
  date_end: "2026-05-24T22:00:00+00:00",
  meeting_key: 1285,
  circuit_key: 23,
  circuit_short_name: "Montreal",
  country_key: 46,
  country_code: "CAN",
  country_name: "Montréal",
  location: "Montréal",
  gmt_offset: "-04:00:00",
  year: 2026,
  is_cancelled: false,
};

const positionFixture = {
  date: "2026-05-24T19:07:20.910000+00:00",
  session_key: 11291,
  meeting_key: 1285,
  position: 1,
  driver_number: 63,
};

const intervalFixture = {
  date: "2026-05-24T19:07:54.848000+00:00",
  session_key: 11291,
  driver_number: 63,
  meeting_key: 1285,
  gap_to_leader: 0.0,
  interval: 0.0,
};

const lapFixture = {
  meeting_key: 1285,
  session_key: 11291,
  driver_number: 41,
  lap_number: 1,
  date_start: "2026-05-24T20:09:47.754000+00:00",
  duration_sector_1: null,
  duration_sector_2: null,
  duration_sector_3: null,
  i1_speed: null,
  i2_speed: null,
  is_pit_out_lap: false,
  lap_duration: null,
  segments_sector_1: [2048, 2048, 2048, 2048, 2048, 2048],
  segments_sector_2: [2048, 2048, 2048, 2048, 2048, 2048],
};

const stintFixture = {
  meeting_key: 1285,
  session_key: 11291,
  stint_number: 1,
  driver_number: 41,
  lap_start: 1,
  lap_end: 1,
  compound: "MEDIUM",
  tyre_age_at_start: 0,
};

const weatherFixture = {
  date: "2026-05-24T19:07:46.504000+00:00",
  session_key: 11291,
  pressure: 1025.5,
  humidity: 74.4,
  wind_direction: 185,
  air_temperature: 12.4,
  meeting_key: 1285,
  track_temperature: 17.2,
  wind_speed: 5.7,
  rainfall: 0,
};

describe("OpenF1 schemas — real-fixture happy path", () => {
  it("SessionSchema accepts the live sessions response", () => {
    expect(() => SessionSchema.parse(sessionFixture)).not.toThrow();
  });

  it("PositionSchema accepts /position rows", () => {
    expect(() => PositionSchema.parse(positionFixture)).not.toThrow();
  });

  it("IntervalSchema accepts /intervals rows with numeric gaps", () => {
    expect(() => IntervalSchema.parse(intervalFixture)).not.toThrow();
  });

  it("IntervalSchema accepts the lapped-driver string variant", () => {
    const lapped = { ...intervalFixture, gap_to_leader: "+1 LAP" };
    expect(() => IntervalSchema.parse(lapped)).not.toThrow();
  });

  it("IntervalSchema tolerates null gap_to_leader (leader at lap 1)", () => {
    const noGap = { ...intervalFixture, gap_to_leader: null, interval: null };
    expect(() => IntervalSchema.parse(noGap)).not.toThrow();
  });

  it("LapSchema tolerates all-null timing fields (lap in progress)", () => {
    expect(() => LapSchema.parse(lapFixture)).not.toThrow();
  });

  it("StintSchema accepts /stints rows", () => {
    expect(() => StintSchema.parse(stintFixture)).not.toThrow();
  });

  it("WeatherSchema accepts /weather rows", () => {
    expect(() => WeatherSchema.parse(weatherFixture)).not.toThrow();
  });
});

describe("OpenF1 schemas — failure cases", () => {
  it("PositionSchema rejects missing required field", () => {
    const broken = { ...positionFixture, position: undefined };
    expect(() => PositionSchema.parse(broken)).toThrow();
  });

  it("PositionSchema rejects wrong type", () => {
    const broken = { ...positionFixture, driver_number: "63" };
    expect(() => PositionSchema.parse(broken)).toThrow();
  });

  it("StintSchema rejects unknown compound", () => {
    const broken = { ...stintFixture, compound: "ULTRA" };
    expect(() => StintSchema.parse(broken)).toThrow();
  });

  it("SessionSchema rejects malformed datetime", () => {
    const broken = { ...sessionFixture, date_start: "not-a-date" };
    expect(() => SessionSchema.parse(broken)).toThrow();
  });
});

describe("ENDPOINT_PAYLOAD_SCHEMAS lookup", () => {
  it("validates a complete position array as one payload", () => {
    const payload = [positionFixture, { ...positionFixture, driver_number: 12, position: 2 }];
    expect(() => ENDPOINT_PAYLOAD_SCHEMAS.position.parse(payload)).not.toThrow();
  });

  it("rejects a non-array payload", () => {
    expect(() => ENDPOINT_PAYLOAD_SCHEMAS.position.parse(positionFixture)).toThrow();
  });
});

describe("isSessionActive", () => {
  const ref = (iso: string): Date => new Date(iso);

  it("returns true mid-session", () => {
    expect(isSessionActive(sessionFixture, ref("2026-05-24T21:00:00+00:00"))).toBe(true);
  });

  it("returns false before start", () => {
    expect(isSessionActive(sessionFixture, ref("2026-05-24T19:30:00+00:00"))).toBe(false);
  });

  it("returns false after end", () => {
    expect(isSessionActive(sessionFixture, ref("2026-05-24T22:30:00+00:00"))).toBe(false);
  });

  it("returns false on cancelled session even if in window", () => {
    const cancelled = { ...sessionFixture, is_cancelled: true };
    expect(isSessionActive(cancelled, ref("2026-05-24T21:00:00+00:00"))).toBe(false);
  });
});
