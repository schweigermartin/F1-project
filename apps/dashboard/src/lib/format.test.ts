import type { DriverState } from "@f1/shared";
import { describe, expect, it } from "vitest";

import { formatGap, formatLapTime, gapChartData, sortedDrivers, tyreInfo } from "./format.js";

function driver(n: number, over: Partial<DriverState> = {}): DriverState {
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
    ...over,
  };
}

describe("sortedDrivers", () => {
  it("orders by position, unknown positions last", () => {
    const map = {
      44: driver(44, { position: 2 }),
      1: driver(1, { position: 1 }),
      77: driver(77),
    };
    expect(sortedDrivers(map).map((d) => d.driver_number)).toEqual([1, 44, 77]);
  });
});

describe("formatGap", () => {
  it("formats numbers, leader, lap strings and null", () => {
    expect(formatGap(0)).toBe("LEADER");
    expect(formatGap(1.234)).toBe("+1.234");
    expect(formatGap("+1 LAP")).toBe("+1 LAP");
    expect(formatGap(null)).toBe("—");
  });
});

describe("formatLapTime", () => {
  it("formats sub-minute and over-minute durations", () => {
    expect(formatLapTime(74.231)).toBe("1:14.231");
    expect(formatLapTime(58.5)).toBe("58.500");
    expect(formatLapTime(null)).toBe("—");
  });
});

describe("tyreInfo", () => {
  it("maps compounds to a label + colour, with a dash fallback", () => {
    expect(tyreInfo("SOFT").label).toBe("S");
    expect(tyreInfo("MEDIUM").label).toBe("M");
    expect(tyreInfo(null).label).toBe("—");
  });
});

describe("gapChartData", () => {
  it("includes only placed drivers and flags lapped ones at the max gap", () => {
    const map = {
      1: driver(1, { position: 1, gap_to_leader: 0 }),
      44: driver(44, { position: 2, gap_to_leader: 3.5 }),
      77: driver(77, { position: 18, gap_to_leader: "+1 LAP" }),
      99: driver(99), // no position → excluded
    };
    const bars = gapChartData(map);
    expect(bars.map((b) => b.driver_number)).toEqual([1, 44, 77]);
    const lapped = bars.find((b) => b.driver_number === 77)!;
    expect(lapped.lapped).toBe(true);
    expect(lapped.gapSeconds).toBe(3.5); // pinned to the largest numeric gap
  });
});
