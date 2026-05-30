import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEDULE_NAME_PREFIX, type ScheduleSyncDeps, syncSchedules } from "../handler.js";

const NOW = new Date("2026-05-23T12:00:00.000Z"); // day before Montréal race

function makeSession(opts: {
  key: number;
  start: string;
  end: string;
  cancelled?: boolean;
}): Record<string, unknown> {
  return {
    session_key: opts.key,
    session_type: "Race",
    session_name: "Race",
    date_start: opts.start,
    date_end: opts.end,
    meeting_key: 1285,
    circuit_key: 23,
    circuit_short_name: "Montreal",
    country_key: 46,
    country_code: "CAN",
    country_name: "Canada",
    location: "Montréal",
    gmt_offset: "-04:00:00",
    year: 2026,
    is_cancelled: opts.cancelled ?? false,
  };
}

function makeMocks(opts: { sessions: unknown; existing?: string[] }): {
  deps: ScheduleSyncDeps;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const fetchSessions = vi.fn(async () => opts.sessions);
  const listExistingSchedules = vi.fn(async () => opts.existing ?? []);
  const upsertSchedule = vi.fn(async () => {});
  const deleteSchedule = vi.fn(async () => {});
  const emitMetric = vi.fn();
  return {
    mocks: { fetchSessions, listExistingSchedules, upsertSchedule, deleteSchedule, emitMetric },
    deps: {
      fetchSessions,
      listExistingSchedules,
      upsertSchedule,
      deleteSchedule,
      now: () => NOW,
      emitMetric,
    },
  };
}

describe("syncSchedules — upserts upcoming sessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates schedules for sessions inside the 48h horizon, with ±buffer windows", async () => {
    const m = makeMocks({
      sessions: [
        makeSession({
          key: 11291,
          start: "2026-05-24T20:00:00+00:00",
          end: "2026-05-24T22:00:00+00:00",
        }),
        makeSession({
          key: 11400,
          start: "2026-06-15T20:00:00+00:00",
          end: "2026-06-15T22:00:00+00:00",
        }), // outside horizon
      ],
    });
    const result = await syncSchedules(m.deps);

    expect(result.upserted).toHaveLength(1);
    expect(result.upserted[0]!.name).toBe(`${SCHEDULE_NAME_PREFIX}11291`);
    expect(result.upserted[0]!.startsAt.toISOString()).toBe("2026-05-24T19:45:00.000Z");
    expect(result.upserted[0]!.endsAt.toISOString()).toBe("2026-05-24T22:30:00.000Z");
    expect(m.mocks["upsertSchedule"]).toHaveBeenCalledTimes(1);
  });

  it("skips cancelled sessions", async () => {
    const m = makeMocks({
      sessions: [
        makeSession({
          key: 11291,
          start: "2026-05-24T20:00:00+00:00",
          end: "2026-05-24T22:00:00+00:00",
          cancelled: true,
        }),
      ],
    });
    const result = await syncSchedules(m.deps);
    expect(result.upserted).toHaveLength(0);
  });

  it("skips already-completed sessions", async () => {
    const m = makeMocks({
      sessions: [
        makeSession({
          key: 11290,
          start: "2026-05-22T12:00:00+00:00",
          end: "2026-05-22T13:00:00+00:00",
        }),
      ],
    });
    const result = await syncSchedules(m.deps);
    expect(result.upserted).toHaveLength(0);
  });
});

describe("syncSchedules — cleanup", () => {
  it("deletes prefix-matching stale schedules that no longer map to an upcoming session", async () => {
    const m = makeMocks({
      sessions: [
        makeSession({
          key: 11291,
          start: "2026-05-24T20:00:00+00:00",
          end: "2026-05-24T22:00:00+00:00",
        }),
      ],
      existing: [
        `${SCHEDULE_NAME_PREFIX}11291`, // wanted
        `${SCHEDULE_NAME_PREFIX}99999`, // stale, must be deleted
        "unrelated-schedule", // not our prefix, must be left alone
      ],
    });
    const result = await syncSchedules(m.deps);
    expect(result.deleted).toEqual([`${SCHEDULE_NAME_PREFIX}99999`]);
    expect(m.mocks["deleteSchedule"]).toHaveBeenCalledWith(`${SCHEDULE_NAME_PREFIX}99999`);
    expect(m.mocks["deleteSchedule"]).not.toHaveBeenCalledWith("unrelated-schedule");
  });

  it("never deletes a schedule whose session is currently RUNNING", async () => {
    const now = new Date("2026-05-24T20:30:00.000Z"); // mid Montréal race
    const m = makeMocks({
      sessions: [],
      existing: [`${SCHEDULE_NAME_PREFIX}11291`],
    });
    m.deps.now = () => now;
    // The list-call returns a stale schedule whose session_key (11291) IS
    // in `validated` but `pickUpcoming` filters it out because the API
    // returned [] — to simulate a transient API hiccup. We must NOT
    // delete a live schedule based on a partial response.
    m.mocks["fetchSessions"]!.mockResolvedValueOnce([
      makeSession({
        key: 11291,
        start: "2026-05-24T20:00:00+00:00",
        end: "2026-05-24T22:00:00+00:00",
      }),
    ]);
    const result = await syncSchedules({ ...m.deps, now: () => now });
    expect(result.deleted).toHaveLength(0);
  });
});

describe("syncSchedules — failure tolerance", () => {
  it("non-array response → metric + early return, no upserts", async () => {
    const m = makeMocks({ sessions: { detail: "wrong shape" } });
    const result = await syncSchedules(m.deps);
    expect(result.upserted).toHaveLength(0);
    expect(m.mocks["emitMetric"]).toHaveBeenCalledWith("ScheduleSyncBadResponse", 1);
  });

  it("invalid session rows are counted in `skipped` and metric", async () => {
    const m = makeMocks({
      sessions: [
        makeSession({
          key: 11291,
          start: "2026-05-24T20:00:00+00:00",
          end: "2026-05-24T22:00:00+00:00",
        }),
        { broken: true },
      ],
    });
    const result = await syncSchedules(m.deps);
    expect(result.upserted).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(m.mocks["emitMetric"]).toHaveBeenCalledWith(
      "SchemaValidationFailure",
      1,
      expect.objectContaining({ stage: "schedule-sync" }),
    );
  });
});
