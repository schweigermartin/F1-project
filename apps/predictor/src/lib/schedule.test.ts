import { describe, expect, it } from "vitest";

import { pickTargetRace, raceHasHappened, resolveRound, type ScheduledRace } from "./schedule";

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

describe("resolveRound", () => {
  const now = new Date("2026-03-10T00:00:00Z"); // between round 1 and 2

  it("pins the requested round when it exists in the schedule", () => {
    const race = resolveRound("1", SEASON, now);
    expect(race?.name).toBe("Australia");
  });

  it("falls back to pickTargetRace when the param is missing", () => {
    const race = resolveRound(undefined, SEASON, now);
    expect(race?.name).toBe("China"); // next race at-or-after `now`
  });

  it("falls back to pickTargetRace when the param is not a known round", () => {
    const race = resolveRound("99", SEASON, now);
    expect(race?.name).toBe("China");
  });

  it("falls back to pickTargetRace when the param is not a number", () => {
    const race = resolveRound("not-a-number", SEASON, now);
    expect(race?.name).toBe("China");
  });

  it("returns null for an empty schedule regardless of the param", () => {
    expect(resolveRound("1", [], now)).toBeNull();
  });
});

describe("raceHasHappened", () => {
  it("is false for a race today or in the future", () => {
    expect(raceHasHappened("2026-06-07", new Date("2026-06-07T09:00:00Z"))).toBe(false);
    expect(raceHasHappened("2026-06-08", new Date("2026-06-07T09:00:00Z"))).toBe(false);
  });

  it("is true once the date is strictly in the past", () => {
    expect(raceHasHappened("2026-06-07", new Date("2026-06-08T00:00:00Z"))).toBe(true);
  });
});
