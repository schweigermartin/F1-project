import { describe, expect, it } from "vitest";

import type { RaceResultRow } from "./f1-api";
import {
  buildProgressionDrivers,
  defaultActiveDrivers,
  formatLapTime,
  type LapRecord,
  median,
  parseLapTime,
  type PitStopRecord,
  toPaceSeries,
  toPositionSeries,
  toStints,
} from "./race-analysis";

function rec(lap: number, driverId: string, position: number, time = "1:30.000"): LapRecord {
  return { lap, driverId, position, time };
}

function stop(driverId: string, lap: number, stopNo = 1, duration = "21.789"): PitStopRecord {
  return { driverId, lap, stop: stopNo, duration };
}

// ─── parseLapTime / formatLapTime ────────────────────────────────────────

describe("parseLapTime", () => {
  it("parses Jolpica's m:ss.mmm form", () => {
    expect(parseLapTime("1:29.421")).toBeCloseTo(89.421, 6);
  });

  it("parses a sub-minute lap without a colon", () => {
    expect(parseLapTime("59.999")).toBeCloseTo(59.999, 6);
  });

  it("parses the h:mm:ss.mmm form Ergast uses for cumulative times", () => {
    expect(parseLapTime("1:02:03.456")).toBeCloseTo(3723.456, 6);
  });

  it("keeps two-digit minutes (a lap behind the safety car)", () => {
    expect(parseLapTime("2:05.100")).toBeCloseTo(125.1, 6);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseLapTime("  1:30.000 ")).toBeCloseTo(90, 6);
  });

  it("returns null — not NaN — for junk", () => {
    for (const bad of ["", "—", "n/a", "1:2a.000", "1::30.000", "1:2:3:4", "90s", "-1:00.000"]) {
      expect(parseLapTime(bad), bad).toBeNull();
    }
  });

  it("rejects a fraction outside the last component", () => {
    expect(parseLapTime("1.5:30.000")).toBeNull();
  });

  it("returns null for a zero time (never a real lap)", () => {
    expect(parseLapTime("0:00.000")).toBeNull();
  });
});

describe("formatLapTime", () => {
  it("round-trips a parsed lap time", () => {
    expect(formatLapTime(parseLapTime("1:29.421") ?? 0)).toBe("1:29.421");
  });

  it("pads the seconds so 1:05 never renders as 1:5", () => {
    expect(formatLapTime(65)).toBe("1:05.000");
  });

  it("drops the minute part below 60s", () => {
    expect(formatLapTime(59.9)).toBe("59.900");
  });

  it("degrades to an em dash for nonsense", () => {
    expect(formatLapTime(Number.NaN)).toBe("—");
    expect(formatLapTime(-1)).toBe("—");
  });
});

// ─── toPositionSeries ────────────────────────────────────────────────────

describe("toPositionSeries", () => {
  it("groups per driver and sorts the points by lap", () => {
    const series = toPositionSeries([
      rec(2, "norris", 1),
      rec(1, "norris", 2),
      rec(1, "piastri", 1),
      rec(2, "piastri", 2),
    ]);
    const norris = series.find((s) => s.driverId === "norris");
    expect(norris?.points).toEqual([
      { lap: 1, position: 2 },
      { lap: 2, position: 1 },
    ]);
  });

  it("reports the final position and last completed lap", () => {
    const series = toPositionSeries([rec(1, "norris", 2), rec(2, "norris", 1)]);
    expect(series[0]).toMatchObject({ finalPosition: 1, lastLap: 2 });
  });

  it("orders finishers by position and pushes retirements behind them", () => {
    // hamilton retires on lap 1 while classified P3; the finishers ran 3 laps.
    const laps = [
      rec(1, "norris", 1),
      rec(2, "norris", 1),
      rec(3, "norris", 1),
      rec(1, "piastri", 2),
      rec(2, "piastri", 2),
      rec(3, "piastri", 2),
      rec(1, "hamilton", 3),
    ];
    expect(toPositionSeries(laps).map((s) => s.driverId)).toEqual([
      "norris",
      "piastri",
      "hamilton",
    ]);
  });

  it("returns an empty array for no input", () => {
    expect(toPositionSeries([])).toEqual([]);
  });
});

// ─── toPaceSeries ────────────────────────────────────────────────────────

describe("median", () => {
  it("handles odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("toPaceSeries", () => {
  /** 20 clean ~90s laps for one driver, plus the outliers passed in. */
  function raceWithOutliers(outliers: Array<[lap: number, time: string]>): LapRecord[] {
    const laps: LapRecord[] = [];
    for (let i = 1; i <= 20; i++)
      laps.push(rec(i, "norris", 1, `1:30.${String(i).padStart(3, "0")}`));
    for (const [lap, time] of outliers) laps.push(rec(lap, "norris", 1, time));
    return laps;
  }

  it("converts lap-time strings to seconds", () => {
    const { series } = toPaceSeries([rec(1, "norris", 1, "1:29.421")]);
    expect(series[0]?.points[0]?.seconds).toBeCloseTo(89.421, 3);
  });

  it("flags safety-car laps as outliers without dropping them", () => {
    const { series, bounds, outlierCount } = toPaceSeries(
      raceWithOutliers([
        [21, "2:15.000"],
        [22, "2:20.000"],
      ]),
    );
    expect(outlierCount).toBe(2);
    expect(bounds.upper).toBeLessThan(120);
    const flagged = series[0]?.points.filter((p) => p.outlier).map((p) => p.lap);
    expect(flagged).toEqual([21, 22]);
    expect(series[0]?.points).toHaveLength(22); // nothing thrown away
  });

  it("keeps the band tight — two +45s laps must not blow up the scale", () => {
    const { bounds } = toPaceSeries(raceWithOutliers([[21, "2:15.000"]]));
    // A mean+stddev band would reach past 100s here; the robust band does not.
    expect(bounds.upper - bounds.median).toBeLessThan(5);
    expect(bounds.median).toBeGreaterThan(90);
    expect(bounds.median).toBeLessThan(91);
  });

  it("never lets the lower bound go negative", () => {
    const { bounds } = toPaceSeries([rec(1, "norris", 1, "1.000"), rec(2, "norris", 1, "1.000")]);
    expect(bounds.lower).toBeGreaterThanOrEqual(0);
  });

  it("falls back to a ±1% band when every lap is identical (MAD = 0)", () => {
    const laps = Array.from({ length: 5 }, (_, i) => rec(i + 1, "norris", 1, "1:30.000"));
    const { bounds, outlierCount } = toPaceSeries(laps);
    expect(bounds.mad).toBe(0);
    expect(bounds.upper).toBeCloseTo(90.9, 3);
    expect(outlierCount).toBe(0); // a degenerate field is not all-outliers
  });

  it("computes median and best from clean laps only", () => {
    const { series } = toPaceSeries(raceWithOutliers([[21, "3:00.000"]]));
    expect(series[0]?.best).toBeCloseTo(90.001, 3);
    expect(series[0]?.median).toBeLessThan(91);
  });

  it("skips unparseable times instead of failing the whole series", () => {
    const { series } = toPaceSeries([
      rec(1, "norris", 1, "1:30.000"),
      rec(2, "norris", 1, "—"),
      rec(3, "norris", 1, "1:31.000"),
    ]);
    expect(series[0]?.points.map((p) => p.lap)).toEqual([1, 3]);
  });

  it("sorts drivers by median pace, fastest first", () => {
    const { series } = toPaceSeries([
      rec(1, "slow", 2, "1:35.000"),
      rec(2, "slow", 2, "1:35.100"),
      rec(1, "fast", 1, "1:30.000"),
      rec(2, "fast", 1, "1:30.100"),
    ]);
    expect(series.map((s) => s.driverId)).toEqual(["fast", "slow"]);
  });

  it("restricts the band to the selected drivers when comparing two", () => {
    const laps = [
      rec(1, "a", 1, "1:30.000"),
      rec(1, "b", 2, "1:31.000"),
      rec(1, "c", 3, "5:00.000"),
    ];
    const { series, bounds } = toPaceSeries(laps, { driverIds: ["a", "b"] });
    expect(series.map((s) => s.driverId).sort()).toEqual(["a", "b"]);
    expect(bounds.upper).toBeLessThan(120); // "c" never entered the statistics
  });

  it("returns a neutral result for an empty race", () => {
    expect(toPaceSeries([])).toEqual({
      series: [],
      bounds: { median: 0, mad: 0, lower: 0, upper: 0 },
      outlierCount: 0,
    });
  });

  it("widens the band with a larger madFactor", () => {
    const laps = raceWithOutliers([]);
    const tight = toPaceSeries(laps, { madFactor: 1 }).bounds;
    const wide = toPaceSeries(laps, { madFactor: 6 }).bounds;
    expect(wide.upper).toBeGreaterThan(tight.upper);
  });
});

// ─── toStints ────────────────────────────────────────────────────────────

describe("toStints", () => {
  const twoStopRace: LapRecord[] = Array.from({ length: 70 }, (_, i) => rec(i + 1, "norris", 1));

  it("derives stint segments from the pit laps", () => {
    const [driver] = toStints(twoStopRace, [stop("norris", 20, 1), stop("norris", 45, 2)]);
    expect(driver?.stints).toEqual([
      { number: 1, startLap: 1, endLap: 20, laps: 20, pitDuration: "21.789" },
      { number: 2, startLap: 21, endLap: 45, laps: 25, pitDuration: "21.789" },
      { number: 3, startLap: 46, endLap: 70, laps: 25, pitDuration: null },
    ]);
  });

  it("gives a driver who never pitted a single full-distance stint", () => {
    const [driver] = toStints(twoStopRace, []);
    expect(driver?.stints).toEqual([
      { number: 1, startLap: 1, endLap: 70, laps: 70, pitDuration: null },
    ]);
  });

  it("sorts unordered pit stops before segmenting", () => {
    const [driver] = toStints(twoStopRace, [stop("norris", 45, 2), stop("norris", 20, 1)]);
    expect(driver?.stints.map((s) => s.endLap)).toEqual([20, 45, 70]);
  });

  it("ends the last stint on the retirement lap", () => {
    const dnf = Array.from({ length: 30 }, (_, i) => rec(i + 1, "stroll", 15));
    const [driver] = toStints(dnf, [stop("stroll", 8)]);
    expect(driver?.lastLap).toBe(30);
    expect(driver?.stints.at(-1)).toMatchObject({ startLap: 9, endLap: 30, laps: 22 });
  });

  it("drops a stop on or after the last lap (retired in the pits)", () => {
    const dnf = Array.from({ length: 10 }, (_, i) => rec(i + 1, "stroll", 15));
    const [driver] = toStints(dnf, [stop("stroll", 10)]);
    expect(driver?.stints).toEqual([
      { number: 1, startLap: 1, endLap: 10, laps: 10, pitDuration: null },
    ]);
  });

  it("collapses a duplicate stop on the same lap instead of emitting a 0-lap stint", () => {
    const [driver] = toStints(twoStopRace, [stop("norris", 20, 1), stop("norris", 20, 2)]);
    expect(driver?.stints.map((s) => s.laps)).toEqual([20, 50]);
    expect(driver?.stints.every((s) => s.laps > 0)).toBe(true);
  });

  it("handles a lap-1 stop without producing an empty first stint", () => {
    const [driver] = toStints(twoStopRace, [stop("norris", 1)]);
    expect(driver?.stints).toEqual([
      { number: 1, startLap: 1, endLap: 1, laps: 1, pitDuration: "21.789" },
      { number: 2, startLap: 2, endLap: 70, laps: 69, pitDuration: null },
    ]);
  });

  it("ignores pit stops for a driver with no lap records at all", () => {
    expect(toStints([], [stop("ghost", 5)])).toEqual([]);
  });

  it("orders drivers by laps completed, then by id", () => {
    const laps = [
      ...Array.from({ length: 5 }, (_, i) => rec(i + 1, "b", 2)),
      ...Array.from({ length: 9 }, (_, i) => rec(i + 1, "a", 1)),
    ];
    expect(toStints(laps, []).map((d) => d.driverId)).toEqual(["a", "b"]);
  });
});

// ─── Driver identity ─────────────────────────────────────────────────────

// `team` rather than `constructor`: an object literal typed against a
// `constructor?: string` field collides with Object.prototype's own.
interface ResultRowInput {
  position: number;
  driverId?: string;
  code?: string;
  driver?: string;
  team?: string;
}

function resultRow(input: ResultRowInput): RaceResultRow {
  return {
    position: input.position,
    driver: input.driver ?? "X",
    code: input.code ?? "XXX",
    ...(input.driverId ? { driverId: input.driverId } : {}),
    constructor: input.team ?? "Team",
    points: "0",
    result: "Finished",
  };
}

describe("buildProgressionDrivers", () => {
  const laps = [rec(1, "max_verstappen", 2), rec(1, "norris", 1), rec(1, "norris", 1)];

  it("joins lap records to the classification by driverId", () => {
    const drivers = buildProgressionDrivers(laps, [
      resultRow({
        position: 1,
        driverId: "norris",
        code: "NOR",
        driver: "Lando Norris",
        team: "McLaren",
      }),
      resultRow({
        position: 2,
        driverId: "max_verstappen",
        code: "VER",
        driver: "Max Verstappen",
        team: "Red Bull",
      }),
    ]);
    expect(drivers).toEqual([
      {
        driverId: "norris",
        code: "NOR",
        name: "Lando Norris",
        constructor: "McLaren",
        finishPosition: 1,
      },
      {
        driverId: "max_verstappen",
        code: "VER",
        name: "Max Verstappen",
        constructor: "Red Bull",
        finishPosition: 2,
      },
    ]);
  });

  it("falls back to a surname-derived code when results are unavailable", () => {
    const drivers = buildProgressionDrivers(laps, null);
    expect(drivers.map((d) => d.code).sort()).toEqual(["NOR", "VER"]);
    expect(drivers.find((d) => d.driverId === "max_verstappen")?.name).toBe("Max Verstappen");
    expect(drivers.every((d) => d.finishPosition === null)).toBe(true);
  });

  it("emits each driver exactly once", () => {
    expect(buildProgressionDrivers(laps, null)).toHaveLength(2);
  });

  it("appends drivers missing from the classification behind the finishers", () => {
    const drivers = buildProgressionDrivers(laps, [
      resultRow({ position: 1, driverId: "norris", code: "NOR" }),
    ]);
    expect(drivers.map((d) => d.driverId)).toEqual(["norris", "max_verstappen"]);
  });
});

describe("defaultActiveDrivers", () => {
  const grid = Array.from({ length: 20 }, (_, i) => ({
    driverId: `d${i + 1}`,
    code: `D${i + 1}`,
    name: `Driver ${i + 1}`,
    constructor: "Team",
    finishPosition: i + 1,
  }));

  it("activates the top ten by default", () => {
    expect(defaultActiveDrivers(grid, null)).toHaveLength(10);
  });

  it("adds the focused driver even from outside the top ten (R-4)", () => {
    const active = defaultActiveDrivers(grid, "D18");
    expect(active).toHaveLength(11);
    expect(active).toContain("d18");
  });

  it("does not duplicate a focused driver already in the top ten", () => {
    expect(defaultActiveDrivers(grid, "D3")).toHaveLength(10);
  });

  it("ignores an unknown focus code", () => {
    expect(defaultActiveDrivers(grid, "ZZZ")).toHaveLength(10);
  });

  it("never returns more drivers than exist", () => {
    expect(defaultActiveDrivers(grid.slice(0, 4), null)).toHaveLength(4);
  });
});
