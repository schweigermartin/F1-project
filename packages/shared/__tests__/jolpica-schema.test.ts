import { describe, expect, it } from "vitest";

import {
  JolpicaLapsSchema,
  JolpicaPitStopsSchema,
  nextJolpicaOffset,
} from "../src/jolpica-schema.js";

// Fixtures trimmed from real responses captured 2026-07-27:
//   https://api.jolpi.ca/ergast/f1/2026/11/laps/?format=json&limit=100&offset=0
//   https://api.jolpi.ca/ergast/f1/2026/11/pitstops/?format=json
// The Hungary race has total=1429 lap timings and total=45 pit stops.

const lapsFixture = {
  MRData: {
    xmlns: "",
    series: "f1",
    url: "https://api.jolpi.ca/ergast/f1/2026/11/laps/",
    limit: "100",
    offset: "0",
    total: "1429",
    RaceTable: {
      season: "2026",
      round: "11",
      Races: [
        {
          season: "2026",
          round: "11",
          url: "https://en.wikipedia.org/wiki/2026_Hungarian_Grand_Prix",
          raceName: "Hungarian Grand Prix",
          date: "2026-07-26",
          time: "13:00:00Z",
          Laps: [
            {
              number: "1",
              Timings: [
                { driverId: "piastri", time: "1:30.286", position: "1" },
                { driverId: "norris", time: "1:31.211", position: "2" },
                { driverId: "max_verstappen", time: "1:32.030", position: "3" },
              ],
            },
          ],
        },
      ],
    },
  },
};

const pitStopsFixture = {
  MRData: {
    limit: "100",
    offset: "0",
    total: "45",
    RaceTable: {
      Races: [
        {
          season: "2026",
          round: "11",
          raceName: "Hungarian Grand Prix",
          date: "2026-07-26",
          PitStops: [
            { driverId: "stroll", lap: "8", stop: "1", time: "15:15:19", duration: "21.789" },
            { driverId: "hamilton", lap: "13", stop: "1", time: "15:21:59", duration: "21.748" },
          ],
        },
      ],
    },
  },
};

describe("JolpicaLapsSchema", () => {
  it("accepts a real page and converts every numeric string to a number", () => {
    const parsed = JolpicaLapsSchema.parse(lapsFixture);
    expect(parsed.MRData.total).toBe(1429);
    expect(parsed.MRData.limit).toBe(100);
    expect(parsed.MRData.offset).toBe(0);

    const race = parsed.MRData.RaceTable.Races[0];
    expect(race?.raceName).toBe("Hungarian Grand Prix");
    expect(race?.season).toBe(2026);
    expect(race?.round).toBe(11);
    expect(race?.Laps[0]?.number).toBe(1);
    expect(race?.Laps[0]?.Timings[2]).toEqual({
      driverId: "max_verstappen",
      position: 3,
      time: "1:32.030",
    });
  });

  it("keeps lap times as raw strings (parsing is the consumer's job)", () => {
    const parsed = JolpicaLapsSchema.parse(lapsFixture);
    expect(parsed.MRData.RaceTable.Races[0]?.Laps[0]?.Timings[0]?.time).toBe("1:30.286");
  });

  it("accepts an empty Races array — a round that has not been run yet", () => {
    const empty = {
      MRData: { limit: "100", offset: "0", total: "0", RaceTable: { Races: [] } },
    };
    expect(JolpicaLapsSchema.parse(empty).MRData.RaceTable.Races).toEqual([]);
  });

  it("ignores unknown extra fields (Ergast adds them freely)", () => {
    expect(JolpicaLapsSchema.safeParse(lapsFixture).success).toBe(true);
  });

  it("fails loudly when the envelope loses its pagination fields", () => {
    const drift = structuredClone(lapsFixture) as { MRData: Record<string, unknown> };
    delete drift.MRData["total"];
    expect(JolpicaLapsSchema.safeParse(drift).success).toBe(false);
  });

  it("fails loudly when a count is not digits-only instead of yielding NaN", () => {
    const drift = structuredClone(lapsFixture);
    drift.MRData.total = "n/a";
    expect(JolpicaLapsSchema.safeParse(drift).success).toBe(false);
  });

  it("fails loudly when a count arrives as a number rather than a string", () => {
    const drift = structuredClone(lapsFixture) as { MRData: Record<string, unknown> };
    drift.MRData["total"] = 1429;
    expect(JolpicaLapsSchema.safeParse(drift).success).toBe(false);
  });

  it("rejects a timing without a driverId", () => {
    const drift = structuredClone(lapsFixture) as {
      MRData: { RaceTable: { Races: Array<{ Laps: Array<{ Timings: unknown[] }> }> } };
    };
    drift.MRData.RaceTable.Races[0]!.Laps[0]!.Timings[0] = { time: "1:30.286", position: "1" };
    expect(JolpicaLapsSchema.safeParse(drift).success).toBe(false);
  });
});

describe("JolpicaPitStopsSchema", () => {
  it("accepts a real page and converts lap/stop counters", () => {
    const parsed = JolpicaPitStopsSchema.parse(pitStopsFixture);
    expect(parsed.MRData.total).toBe(45);
    expect(parsed.MRData.RaceTable.Races[0]?.PitStops[0]).toEqual({
      driverId: "stroll",
      lap: 8,
      stop: 1,
      time: "15:15:19",
      duration: "21.789",
    });
  });

  it("keeps the duration as a string — it is fractional, not an integer count", () => {
    const parsed = JolpicaPitStopsSchema.parse(pitStopsFixture);
    expect(parsed.MRData.RaceTable.Races[0]?.PitStops[1]?.duration).toBe("21.748");
  });

  it("fails loudly when a stop loses its lap", () => {
    const drift = structuredClone(pitStopsFixture) as {
      MRData: { RaceTable: { Races: Array<{ PitStops: unknown[] }> } };
    };
    drift.MRData.RaceTable.Races[0]!.PitStops[0] = {
      driverId: "stroll",
      stop: "1",
      time: "15:15:19",
      duration: "21.789",
    };
    expect(JolpicaPitStopsSchema.safeParse(drift).success).toBe(false);
  });
});

describe("nextJolpicaOffset", () => {
  it("walks a 1429-record race in 100-record pages and stops exactly once", () => {
    const offsets: number[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      offsets.push(offset);
      offset = nextJolpicaOffset({ limit: 100, offset, total: 1429 });
    }
    expect(offsets).toHaveLength(15);
    expect(offsets.at(-1)).toBe(1400);
  });

  it("returns null when a single page already covers the total", () => {
    expect(nextJolpicaOffset({ limit: 100, offset: 0, total: 45 })).toBeNull();
  });

  it("returns null on an exact boundary (no empty trailing page)", () => {
    expect(nextJolpicaOffset({ limit: 100, offset: 100, total: 200 })).toBeNull();
  });

  it("returns null for an empty result set", () => {
    expect(nextJolpicaOffset({ limit: 100, offset: 0, total: 0 })).toBeNull();
  });

  it("refuses to loop forever when the server reports limit 0", () => {
    expect(nextJolpicaOffset({ limit: 0, offset: 0, total: 1429 })).toBeNull();
  });
});
