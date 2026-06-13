import { describe, expect, it } from "vitest";

import { buildDriverFocus, resolveSelection } from "./explorer";
import type { DriverStanding, RaceMeta, RaceResultRow } from "./f1-api";

const SCHED: RaceMeta[] = [
  { round: 1, name: "Australia", circuit: "Albert Park", date: "2026-03-08", startsAt: null },
  { round: 7, name: "Spain", circuit: "Catalunya", date: "2026-06-14", startsAt: null },
  { round: 8, name: "Canada", circuit: "Villeneuve", date: "2026-06-28", startsAt: null },
];

describe("resolveSelection", () => {
  it("uses a valid requested round/session/driver", () => {
    const sel = resolveSelection(
      { round: "7", session: "qualifying", driver: "ver" },
      SCHED,
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(sel.round).toBe(7);
    expect(sel.session).toBe("qualifying");
    expect(sel.driver).toBe("VER"); // normalized upper-case
    expect(sel.race?.name).toBe("Spain");
  });

  it("falls back to the next race + 'race' session for missing/invalid params", () => {
    const sel = resolveSelection({}, SCHED, new Date("2026-06-10T00:00:00Z"));
    expect(sel.round).toBe(7); // next at/after 2026-06-10
    expect(sel.session).toBe("race");
    expect(sel.driver).toBeNull();
  });

  it("ignores an out-of-range round and a bogus session", () => {
    const sel = resolveSelection(
      { round: "99", session: "warmup" },
      SCHED,
      new Date("2026-06-20T00:00:00Z"),
    );
    expect(sel.round).toBe(8); // 99 invalid → default (next/last = Canada)
    expect(sel.session).toBe("race");
  });

  it("does not crash on an empty schedule", () => {
    const sel = resolveSelection({ round: "3" }, [], new Date());
    expect(sel.race).toBeNull();
    expect(sel.round).toBe(0);
  });
});

describe("buildDriverFocus", () => {
  const standings: DriverStanding[] = [
    { position: 3, points: "148", wins: "2", name: "Max Verstappen", code: "VER", constructor: "Red Bull Racing" },
  ];
  const rows: RaceResultRow[] = [
    { position: 2, driver: "Max Verstappen", code: "VER", constructor: "Red Bull Racing", points: "18", grid: "3", result: "+5.1s" },
  ];

  it("merges standings + race result for the focused driver", () => {
    const focus = buildDriverFocus("VER", standings, rows);
    expect(focus?.championshipPos).toBe(3);
    expect(focus?.points).toBe("148");
    expect(focus?.raceResult).toEqual({ position: 2, result: "+5.1s", points: "18", grid: "3" });
  });

  it("returns null when the driver appears nowhere", () => {
    expect(buildDriverFocus("XXX", standings, rows)).toBeNull();
  });

  it("works with standings only (race not yet run)", () => {
    const focus = buildDriverFocus("VER", standings, null);
    expect(focus?.raceResult).toBeNull();
    expect(focus?.championshipPos).toBe(3);
  });
});
