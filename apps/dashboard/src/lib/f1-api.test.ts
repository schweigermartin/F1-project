import { describe, expect, it } from "vitest";

import { pickNextRace, type RaceMeta } from "./f1-api";

function race(round: number, date: string): RaceMeta {
  return { round, name: `R${round}`, circuit: "C", date, startsAt: `${date}T13:00:00Z` };
}

const SCHEDULE: RaceMeta[] = [
  race(1, "2026-03-08"),
  race(2, "2026-03-22"),
  race(3, "2026-04-05"),
  race(4, "2026-06-07"),
];

describe("pickNextRace", () => {
  it("returns the earliest race at or after today", () => {
    const next = pickNextRace(SCHEDULE, new Date("2026-03-23T10:00:00Z"));
    expect(next?.round).toBe(3);
  });

  it("counts a race happening today as next", () => {
    const next = pickNextRace(SCHEDULE, new Date("2026-04-05T08:00:00Z"));
    expect(next?.round).toBe(3);
  });

  it("returns the opener before the season starts", () => {
    expect(pickNextRace(SCHEDULE, new Date("2026-01-01T00:00:00Z"))?.round).toBe(1);
  });

  it("returns null once the season is over", () => {
    expect(pickNextRace(SCHEDULE, new Date("2026-12-31T00:00:00Z"))).toBeNull();
  });

  it("ignores schedule order, picks by date", () => {
    const shuffled = [race(4, "2026-06-07"), race(1, "2026-03-08"), race(2, "2026-03-22")];
    expect(pickNextRace(shuffled, new Date("2026-03-10T00:00:00Z"))?.round).toBe(2);
  });
});
