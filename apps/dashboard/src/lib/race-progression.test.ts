import { afterEach, describe, expect, it, vi } from "vitest";

import { getLapChart, getPitStops } from "./race-progression";

// ─── Fake Jolpica ────────────────────────────────────────────────────────
// Shapes mirror the real responses (every number a string) so the schema does
// real work here — a drifting fixture fails the test, not just the assertion.

interface FakeTiming {
  driverId: string;
  position: string;
  time: string;
}

function lapsPage(opts: {
  offset: number;
  limit: number;
  total: number;
  laps: Array<{ number: string; Timings: FakeTiming[] }>;
}): unknown {
  return {
    MRData: {
      limit: String(opts.limit),
      offset: String(opts.offset),
      total: String(opts.total),
      RaceTable: {
        Races: [
          {
            season: "2026",
            round: "11",
            raceName: "Hungarian Grand Prix",
            date: "2026-07-26",
            Laps: opts.laps,
          },
        ],
      },
    },
  };
}

function pitStopsPage(opts: {
  offset: number;
  limit: number;
  total: number;
  stops: Array<{ driverId: string; lap: string; stop: string; duration: string }>;
}): unknown {
  return {
    MRData: {
      limit: String(opts.limit),
      offset: String(opts.offset),
      total: String(opts.total),
      RaceTable: {
        Races: [
          {
            season: "2026",
            round: "11",
            raceName: "Hungarian Grand Prix",
            date: "2026-07-26",
            PitStops: opts.stops.map((s) => ({ ...s, time: "15:15:19" })),
          },
        ],
      },
    },
  };
}

const EMPTY_PAGE: unknown = {
  MRData: { limit: "100", offset: "0", total: "0", RaceTable: { Races: [] } },
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}
function notOk(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("no body")),
  } as unknown as Response;
}

/** Serve the given responses in order; extra calls throw (over-fetching is a bug). */
function serve(...responses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const mock = vi.fn(() => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch");
    return Promise.resolve(next);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── getLapChart ─────────────────────────────────────────────────────────

describe("getLapChart", () => {
  it("pages until total is covered and flattens a lap split across a boundary", async () => {
    // 4 records over 3 pages of 2 — the same shape as the real 1429/100 race,
    // including lap 2 arriving in two halves.
    const mock = serve(
      ok(
        lapsPage({
          offset: 0,
          limit: 2,
          total: 4,
          laps: [
            {
              number: "1",
              Timings: [
                { driverId: "piastri", position: "1", time: "1:30.286" },
                { driverId: "norris", position: "2", time: "1:31.211" },
              ],
            },
          ],
        }),
      ),
      ok(
        lapsPage({
          offset: 2,
          limit: 2,
          total: 4,
          laps: [
            { number: "2", Timings: [{ driverId: "piastri", position: "1", time: "1:29.900" }] },
          ],
        }),
      ),
      ok(
        lapsPage({
          offset: 4,
          limit: 2,
          total: 4,
          laps: [
            { number: "2", Timings: [{ driverId: "norris", position: "2", time: "1:30.100" }] },
          ],
        }),
      ),
    );

    const chart = await getLapChart(2026, 11);
    expect(chart).not.toBeNull();
    // Page 3 is never requested: offset 2 + limit 2 already reaches total 4.
    expect(mock).toHaveBeenCalledTimes(2);
    expect(chart?.records).toHaveLength(3);
    expect(chart?.records.map((r) => `${r.lap}:${r.driverId}`)).toEqual([
      "1:piastri",
      "1:norris",
      "2:piastri",
    ]);
    expect(chart?.totalLaps).toBe(2);
    expect(chart?.raceName).toBe("Hungarian Grand Prix");
    expect(chart?.date).toBe("2026-07-26");
    expect(chart?.season).toBe(2026);
    expect(chart?.round).toBe(11);
  });

  it("requests limit=100 and walks the offset", async () => {
    const mock = serve(
      ok(
        lapsPage({
          offset: 0,
          limit: 2,
          total: 3,
          laps: [
            {
              number: "1",
              Timings: [
                { driverId: "a", position: "1", time: "1:30.000" },
                { driverId: "b", position: "2", time: "1:31.000" },
              ],
            },
          ],
        }),
      ),
      ok(
        lapsPage({
          offset: 2,
          limit: 2,
          total: 3,
          laps: [{ number: "2", Timings: [{ driverId: "a", position: "1", time: "1:29.000" }] }],
        }),
      ),
    );

    const chart = await getLapChart(2026, 11);
    expect(chart?.records).toHaveLength(3);
    expect(mock).toHaveBeenCalledTimes(2);
    const urls = mock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("limit=100&offset=0");
    expect(urls[1]).toContain("limit=100&offset=2");
    expect(urls[0]).toContain("/2026/11/laps/");
  });

  it("stops after a single request when the first page covers the total", async () => {
    const mock = serve(
      ok(
        lapsPage({
          offset: 0,
          limit: 100,
          total: 1,
          laps: [{ number: "1", Timings: [{ driverId: "a", position: "1", time: "1:30.000" }] }],
        }),
      ),
    );
    await getLapChart(2026, 11);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("caches long — a finished race never changes", async () => {
    const mock = serve(
      ok(
        lapsPage({
          offset: 0,
          limit: 100,
          total: 1,
          laps: [{ number: "1", Timings: [{ driverId: "a", position: "1", time: "1:30.000" }] }],
        }),
      ),
    );
    await getLapChart(2026, 11);
    const init = mock.mock.calls[0]?.[1] as { next?: { revalidate?: number } } | undefined;
    expect(init?.next?.revalidate).toBeGreaterThanOrEqual(86_400);
  });

  it("converts the string fields to numbers", async () => {
    serve(
      ok(
        lapsPage({
          offset: 0,
          limit: 100,
          total: 1,
          laps: [{ number: "7", Timings: [{ driverId: "a", position: "3", time: "1:30.000" }] }],
        }),
      ),
    );
    const chart = await getLapChart(2026, 11);
    expect(chart?.records[0]).toEqual({
      lap: 7,
      driverId: "a",
      position: 3,
      time: "1:30.000",
    });
  });

  it("returns null for a round with no lap data (not run / cancelled)", async () => {
    serve(ok(EMPTY_PAGE));
    expect(await getLapChart(2026, 24)).toBeNull();
  });

  it("returns null on a non-200 response", async () => {
    serve(notOk(503));
    expect(await getLapChart(2026, 11)).toBeNull();
  });

  it("returns null on schema drift rather than rendering half a race", async () => {
    serve(ok({ MRData: { RaceTable: { Races: [] } } })); // pagination fields gone
    expect(await getLapChart(2026, 11)).toBeNull();
  });

  it("aborts the whole chart when a LATER page fails", async () => {
    serve(
      ok(
        lapsPage({
          offset: 0,
          limit: 2,
          total: 4,
          laps: [
            {
              number: "1",
              Timings: [
                { driverId: "a", position: "1", time: "1:30.000" },
                { driverId: "b", position: "2", time: "1:31.000" },
              ],
            },
          ],
        }),
      ),
      notOk(500),
    );
    expect(await getLapChart(2026, 11)).toBeNull();
  });

  it("returns null when the network throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNRESET"))),
    );
    expect(await getLapChart(2026, 11)).toBeNull();
  });

  it("terminates when a page adds nothing but claims more records exist", async () => {
    const mock = serve(
      ok(lapsPage({ offset: 0, limit: 2, total: 999, laps: [{ number: "1", Timings: [] }] })),
    );
    expect(await getLapChart(2026, 11)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

// ─── getPitStops ─────────────────────────────────────────────────────────

describe("getPitStops", () => {
  it("pages through the stops (45 > the default limit of 30)", async () => {
    const mock = serve(
      ok(
        pitStopsPage({
          offset: 0,
          limit: 2,
          total: 3,
          stops: [
            { driverId: "stroll", lap: "8", stop: "1", duration: "21.789" },
            { driverId: "hamilton", lap: "13", stop: "1", duration: "21.748" },
          ],
        }),
      ),
      ok(
        pitStopsPage({
          offset: 2,
          limit: 2,
          total: 3,
          stops: [{ driverId: "max_verstappen", lap: "14", stop: "1", duration: "21.625" }],
        }),
      ),
    );

    const stops = await getPitStops(2026, 11);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(stops).toEqual([
      { driverId: "stroll", lap: 8, stop: 1, duration: "21.789" },
      { driverId: "hamilton", lap: 13, stop: 1, duration: "21.748" },
      { driverId: "max_verstappen", lap: 14, stop: 1, duration: "21.625" },
    ]);
  });

  it("hits the /pitstops resource of the requested round", async () => {
    const mock = serve(ok(pitStopsPage({ offset: 0, limit: 100, total: 0, stops: [] })));
    await getPitStops(2026, 7);
    expect(String(mock.mock.calls[0]?.[0])).toContain("/2026/7/pitstops/?format=json&limit=100");
  });

  it("returns an empty list for a round that reports no stops", async () => {
    serve(ok(EMPTY_PAGE));
    expect(await getPitStops(2026, 24)).toEqual([]);
  });

  it("returns null on failure so the caller can still draw the position chart", async () => {
    serve(notOk(429));
    expect(await getPitStops(2026, 11)).toBeNull();
  });

  it("returns null on schema drift", async () => {
    serve(ok({ MRData: { limit: "100", offset: "0", total: "1", RaceTable: {} } }));
    expect(await getPitStops(2026, 11)).toBeNull();
  });
});
