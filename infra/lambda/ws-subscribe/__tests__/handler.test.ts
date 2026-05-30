import {
  driverIntervalSK,
  driverPositionSK,
  lapSK,
  PK_ATTR,
  type ServerMessage,
  sessionPK,
  SK_ATTR,
  stintSK,
  TTL_ATTR,
  weatherSK,
} from "@f1/shared";
import { describe, expect, it, vi } from "vitest";

import {
  buildSnapshot,
  buildSnapshotMessages,
  handleSubscribe,
  type SubscribeDeps,
} from "../handler.js";

const TTL = 1_900_000_000;

// Mirror the Consumer's item shape: { PK, SK, expiresAt, endpoint, ...row }.
function item(sk: string, endpoint: string, row: Record<string, unknown>): Record<string, unknown> {
  return { [PK_ATTR]: sessionPK("11291"), [SK_ATTR]: sk, [TTL_ATTR]: TTL, endpoint, ...row };
}

const FIXTURE_ITEMS = [
  item(driverPositionSK(44), "position", { driver_number: 44, position: 2 }),
  item(driverPositionSK(1), "position", { driver_number: 1, position: 1 }),
  item(driverIntervalSK(44), "intervals", {
    driver_number: 44,
    gap_to_leader: 1.234,
    interval: 1.234,
  }),
  item(driverIntervalSK(1), "intervals", { driver_number: 1, gap_to_leader: 0, interval: null }),
  item(stintSK(44, 1), "stints", {
    driver_number: 44,
    stint_number: 1,
    compound: "MEDIUM",
    tyre_age_at_start: 0,
  }),
  item(stintSK(44, 2), "stints", {
    driver_number: 44,
    stint_number: 2,
    compound: "HARD",
    tyre_age_at_start: 3,
  }),
  item(lapSK(44, 40), "laps", { driver_number: 44, lap_number: 40, lap_duration: 75.1 }),
  item(lapSK(44, 41), "laps", { driver_number: 44, lap_number: 41, lap_duration: 74.8 }),
  item(weatherSK(), "weather", {
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
  }),
];

describe("buildSnapshot", () => {
  it("aggregates one DriverState per driver, sorted by position", () => {
    const { drivers } = buildSnapshot(FIXTURE_ITEMS);
    expect(drivers.map((d) => d.driver_number)).toEqual([1, 44]);
  });

  it("takes the latest stint (highest stint_number) for tyre + compound", () => {
    const { drivers } = buildSnapshot(FIXTURE_ITEMS);
    const d44 = drivers.find((d) => d.driver_number === 44)!;
    expect(d44.stint_number).toBe(2);
    expect(d44.compound).toBe("HARD");
    expect(d44.tyre_age).toBe(3);
  });

  it("takes the latest lap (highest lap_number) for last_lap", () => {
    const { drivers } = buildSnapshot(FIXTURE_ITEMS);
    const d44 = drivers.find((d) => d.driver_number === 44)!;
    expect(d44.last_lap_number).toBe(41);
    expect(d44.last_lap_duration).toBe(74.8);
  });

  it("carries position + interval, including a lap-string-friendly null", () => {
    const { drivers } = buildSnapshot(FIXTURE_ITEMS);
    const leader = drivers.find((d) => d.driver_number === 1)!;
    expect(leader.position).toBe(1);
    expect(leader.gap_to_leader).toBe(0);
    expect(leader.interval).toBeNull();
  });

  it("parses the weather item (extra DDB attrs stripped by the schema)", () => {
    const { weather } = buildSnapshot(FIXTURE_ITEMS);
    expect(weather?.air_temperature).toBe(24);
    expect(weather).not.toHaveProperty(PK_ATTR);
  });

  it("ignores rows without a driver_number", () => {
    const { drivers } = buildSnapshot([item("driver#x#position", "position", { position: 5 })]);
    expect(drivers).toHaveLength(0);
  });
});

describe("buildSnapshotMessages", () => {
  it("returns a single un-parted frame when it fits", () => {
    const { drivers, weather } = buildSnapshot(FIXTURE_ITEMS);
    const msgs = buildSnapshotMessages("11291", drivers, weather);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).not.toHaveProperty("part");
  });

  it("chunks into parts when over the byte budget, weather only on frame 1", () => {
    const { drivers, weather } = buildSnapshot(FIXTURE_ITEMS);
    // Force chunking with a tiny budget.
    const msgs = buildSnapshotMessages("11291", drivers, weather, 200);
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(m.type).toBe("snapshot");
      if (m.type === "snapshot") expect(m.part?.of).toBe(msgs.length);
    }
    const first = msgs[0];
    const last = msgs[msgs.length - 1];
    if (first?.type === "snapshot") expect(first.weather).not.toBeNull();
    if (last?.type === "snapshot" && msgs.length > 1) expect(last.weather).toBeNull();
  });
});

function deps(over: Partial<SubscribeDeps> = {}): { d: SubscribeDeps; posted: ServerMessage[] } {
  const posted: ServerMessage[] = [];
  const d: SubscribeDeps = {
    resolveActiveSessionId: vi.fn().mockResolvedValue("11291"),
    setSubscription: vi.fn().mockResolvedValue(undefined),
    querySession: vi.fn().mockResolvedValue(FIXTURE_ITEMS),
    post: vi.fn(async (m: ServerMessage) => {
      posted.push(m);
    }),
    ...over,
  };
  return { d, posted };
}

describe("handleSubscribe", () => {
  it("subscribes to an explicit session and posts a snapshot", async () => {
    const { d, posted } = deps();
    const result = await handleSubscribe({ connectionId: "c1", session_id: "11291" }, d);
    expect(d.resolveActiveSessionId).not.toHaveBeenCalled();
    expect(d.setSubscription).toHaveBeenCalledWith("c1", "11291");
    expect(result.subscribed).toBe(true);
    expect(posted[0]?.type).toBe("snapshot");
  });

  it("resolves the active session when none is given", async () => {
    const { d } = deps();
    const result = await handleSubscribe({ connectionId: "c1" }, d);
    expect(d.resolveActiveSessionId).toHaveBeenCalledOnce();
    expect(result.session_id).toBe("11291");
  });

  it("posts no-live-session and does not subscribe when none is active", async () => {
    const { d, posted } = deps({ resolveActiveSessionId: vi.fn().mockResolvedValue(null) });
    const result = await handleSubscribe({ connectionId: "c1" }, d);
    expect(result.subscribed).toBe(false);
    expect(d.setSubscription).not.toHaveBeenCalled();
    expect(posted).toEqual([{ type: "info", code: "no-live-session" }]);
  });
});
