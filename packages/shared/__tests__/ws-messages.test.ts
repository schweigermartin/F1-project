import { describe, expect, it } from "vitest";

import {
  ClientMessageSchema,
  type DriverState,
  DriverStateSchema,
  ServerMessageSchema,
} from "../src/ws-messages.js";

describe("ClientMessageSchema", () => {
  it("accepts subscribe with an explicit session_id", () => {
    expect(() =>
      ClientMessageSchema.parse({ action: "subscribe", session_id: "11291" }),
    ).not.toThrow();
  });

  it("accepts subscribe without a session_id (backend resolves active session)", () => {
    expect(() => ClientMessageSchema.parse({ action: "subscribe" })).not.toThrow();
  });

  it("accepts replayStart with an allowed speed", () => {
    expect(() =>
      ClientMessageSchema.parse({ action: "replayStart", session_id: "11291", speed: 4 }),
    ).not.toThrow();
  });

  it("rejects replayStart with a disallowed speed", () => {
    expect(() =>
      ClientMessageSchema.parse({ action: "replayStart", session_id: "11291", speed: 3 }),
    ).toThrow();
  });

  it("rejects replayStart without a session_id", () => {
    expect(() => ClientMessageSchema.parse({ action: "replayStart", speed: 2 })).toThrow();
  });

  it("accepts replayStop", () => {
    expect(() => ClientMessageSchema.parse({ action: "replayStop" })).not.toThrow();
  });

  it("rejects an unknown action", () => {
    expect(() => ClientMessageSchema.parse({ action: "telemetry" })).toThrow();
  });
});

describe("ServerMessageSchema", () => {
  const driver: DriverState = {
    driver_number: 44,
    position: 1,
    gap_to_leader: null,
    interval: 0.412,
    compound: "MEDIUM",
    stint_number: 2,
    tyre_age: 11,
    last_lap_number: 42,
    last_lap_duration: 74.231,
  };

  it("accepts a snapshot with drivers and null weather", () => {
    expect(() =>
      ServerMessageSchema.parse({
        type: "snapshot",
        session_id: "11291",
        drivers: [driver],
        weather: null,
      }),
    ).not.toThrow();
  });

  it("accepts a chunked snapshot via part", () => {
    expect(() =>
      ServerMessageSchema.parse({
        type: "snapshot",
        session_id: "11291",
        drivers: [driver],
        weather: null,
        part: { n: 1, of: 3 },
      }),
    ).not.toThrow();
  });

  it("accepts a delta with an unknown body (narrowed downstream by entity)", () => {
    expect(() =>
      ServerMessageSchema.parse({
        type: "delta",
        session_id: "11291",
        entity: "position",
        data: { driver_number: 44, position: 1 },
      }),
    ).not.toThrow();
  });

  it("rejects a delta with an unknown entity", () => {
    expect(() =>
      ServerMessageSchema.parse({
        type: "delta",
        session_id: "11291",
        entity: "telemetry",
        data: {},
      }),
    ).toThrow();
  });

  it("accepts replay:end, info, and error", () => {
    expect(() =>
      ServerMessageSchema.parse({ type: "replay:end", session_id: "11291" }),
    ).not.toThrow();
    expect(() =>
      ServerMessageSchema.parse({ type: "info", code: "no-live-session" }),
    ).not.toThrow();
    expect(() => ServerMessageSchema.parse({ type: "error", message: "boom" })).not.toThrow();
  });

  it("rejects an info with an unknown code", () => {
    expect(() => ServerMessageSchema.parse({ type: "info", code: "kaboom" })).toThrow();
  });
});

describe("DriverStateSchema", () => {
  it("allows every field except driver_number to be null (partial live data)", () => {
    expect(() =>
      DriverStateSchema.parse({
        driver_number: 81,
        position: null,
        gap_to_leader: null,
        interval: null,
        compound: null,
        stint_number: null,
        tyre_age: null,
        last_lap_number: null,
        last_lap_duration: null,
      }),
    ).not.toThrow();
  });

  it("accepts a lap-string gap like '+1 LAP'", () => {
    const parsed = DriverStateSchema.parse({
      driver_number: 81,
      position: 18,
      gap_to_leader: "+1 LAP",
      interval: "+1 LAP",
      compound: "HARD",
      stint_number: 1,
      tyre_age: 30,
      last_lap_number: 41,
      last_lap_duration: null,
    });
    expect(parsed.gap_to_leader).toBe("+1 LAP");
  });

  it("requires driver_number", () => {
    expect(() => DriverStateSchema.parse({ position: 1 })).toThrow();
  });
});
