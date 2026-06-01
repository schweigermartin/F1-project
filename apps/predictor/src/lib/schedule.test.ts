import { describe, expect, it } from "vitest";

import { pickTargetRace, type ScheduledRace } from "./schedule";

const SEASON: ScheduledRace[] = [
  { round: 1, date: "2026-03-08", name: "Australia" },
  { round: 2, date: "2026-03-22", name: "China" },
  { round: 3, date: "2026-06-07", name: "Canada" },
];

describe("pickTargetRace", () => {
  it("returns the next race at or after today", () => {
    const race = pickTargetRace(SEASON, new Date("2026-03-10T00:00:00Z"));
    expect(race?.name).toBe("China");
  });

  it("includes a race happening today", () => {
    const race = pickTargetRace(SEASON, new Date("2026-06-07T09:00:00Z"));
    expect(race?.name).toBe("Canada");
  });

  it("falls back to the last race once the season is over", () => {
    const race = pickTargetRace(SEASON, new Date("2026-12-01T00:00:00Z"));
    expect(race?.name).toBe("Canada");
  });

  it("returns null for an empty schedule", () => {
    expect(pickTargetRace([], new Date())).toBeNull();
  });
});
