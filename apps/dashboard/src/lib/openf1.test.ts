import type { Lap } from "@f1/shared";
import { describe, expect, it } from "vitest";

import { fastestPerDriver } from "./openf1";

function lap(driver_number: number, lap_duration: number | null, opts: Partial<Lap> = {}): Lap {
  return {
    meeting_key: 1,
    session_key: 1,
    driver_number,
    lap_number: 1,
    date_start: null,
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
    i1_speed: null,
    i2_speed: null,
    is_pit_out_lap: false,
    lap_duration,
    ...opts,
  };
}

describe("fastestPerDriver", () => {
  it("keeps the minimum valid lap per driver, sorted ascending", () => {
    const ranked = fastestPerDriver([
      lap(1, 80.5),
      lap(1, 79.9),
      lap(16, 79.2),
      lap(16, 81.0),
    ]);
    expect(ranked).toEqual([
      { driver_number: 16, lap: 79.2 },
      { driver_number: 1, lap: 79.9 },
    ]);
  });

  it("ignores null (in-progress) laps and pit-out laps", () => {
    const ranked = fastestPerDriver([
      lap(1, null),
      lap(1, 70.0, { is_pit_out_lap: true }),
      lap(1, 78.3),
    ]);
    expect(ranked).toEqual([{ driver_number: 1, lap: 78.3 }]);
  });

  it("returns [] when no driver has a valid lap", () => {
    expect(fastestPerDriver([lap(1, null), lap(2, null)])).toEqual([]);
  });
});
