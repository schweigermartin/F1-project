import type { ServerMessage } from "@f1/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { applyEntity, useRaceStore } from "./race-store.js";

function emptyDriver(n: number) {
  return {
    driver_number: n,
    position: null,
    gap_to_leader: null,
    interval: null,
    compound: null,
    stint_number: null,
    tyre_age: null,
    last_lap_number: null,
    last_lap_duration: null,
  };
}

const snapshot: Extract<ServerMessage, { type: "snapshot" }> = {
  type: "snapshot",
  session_id: "11291",
  drivers: [
    { ...emptyDriver(1), position: 1 },
    { ...emptyDriver(44), position: 2 },
  ],
  weather: null,
};

beforeEach(() => useRaceStore.getState().reset());

describe("applyEntity", () => {
  it("sets position and interval fields", () => {
    let d = applyEntity(emptyDriver(44), "position", { position: 3 });
    expect(d.position).toBe(3);
    d = applyEntity(d, "interval", { gap_to_leader: 1.2, interval: 0.5 });
    expect(d.gap_to_leader).toBe(1.2);
    expect(d.interval).toBe(0.5);
  });

  it("keeps the latest stint and ignores an older stint number", () => {
    let d = applyEntity(emptyDriver(44), "stint", {
      stint_number: 2,
      compound: "HARD",
      tyre_age_at_start: 5,
    });
    expect(d.compound).toBe("HARD");
    d = applyEntity(d, "stint", { stint_number: 1, compound: "SOFT", tyre_age_at_start: 0 });
    expect(d.compound).toBe("HARD"); // older stint ignored
    expect(d.stint_number).toBe(2);
  });

  it("keeps the latest lap and ignores an older lap number", () => {
    let d = applyEntity(emptyDriver(44), "lap", { lap_number: 41, lap_duration: 74.8 });
    d = applyEntity(d, "lap", { lap_number: 40, lap_duration: 99 });
    expect(d.last_lap_number).toBe(41);
    expect(d.last_lap_duration).toBe(74.8);
  });
});

describe("race store", () => {
  it("applies a snapshot into the driver map", () => {
    useRaceStore.getState().applySnapshot(snapshot);
    const s = useRaceStore.getState();
    expect(s.sessionId).toBe("11291");
    expect(Object.keys(s.drivers)).toHaveLength(2);
    expect(s.drivers[1]?.position).toBe(1);
  });

  it("merges chunked snapshot frames instead of replacing", () => {
    useRaceStore.getState().applySnapshot(snapshot);
    useRaceStore.getState().applySnapshot({
      ...snapshot,
      drivers: [{ ...emptyDriver(81), position: 3 }],
      part: { n: 2, of: 2 },
    });
    expect(Object.keys(useRaceStore.getState().drivers)).toHaveLength(3);
  });

  it("patches a driver from a delta, creating it if unseen", () => {
    useRaceStore.getState().applyDelta({
      type: "delta",
      session_id: "11291",
      entity: "position",
      data: { driver_number: 16, position: 4 },
    });
    expect(useRaceStore.getState().drivers[16]?.position).toBe(4);
  });

  it("applies a weather delta to the weather slot, not a driver", () => {
    useRaceStore.getState().applyDelta({
      type: "delta",
      session_id: "11291",
      entity: "weather",
      data: {
        date: "2026-05-24T20:30:00.000+00:00",
        session_key: 11291,
        meeting_key: 1,
        pressure: 1012,
        humidity: 40,
        wind_direction: 180,
        air_temperature: 24,
        track_temperature: 41,
        wind_speed: 2,
        rainfall: 0,
      },
    });
    expect(useRaceStore.getState().weather?.air_temperature).toBe(24);
    expect(Object.keys(useRaceStore.getState().drivers)).toHaveLength(0);
  });

  it("ignores a delta without a driver_number", () => {
    useRaceStore.getState().applyDelta({
      type: "delta",
      session_id: "11291",
      entity: "position",
      data: { position: 4 },
    });
    expect(Object.keys(useRaceStore.getState().drivers)).toHaveLength(0);
  });
});
