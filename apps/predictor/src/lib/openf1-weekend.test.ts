import type { Session } from "@f1/shared";
import { describe, expect, it } from "vitest";

import { pickWeekendForRace } from "./openf1-weekend";

function session(over: Partial<Session> & Pick<Session, "session_type" | "date_start">): Session {
  return {
    session_key: Math.floor(Math.random() * 1e6),
    session_name: over.session_type,
    date_end: over.date_start,
    meeting_key: 100,
    circuit_key: 1,
    circuit_short_name: "Test",
    country_key: 1,
    country_code: "TST",
    country_name: "Testland",
    location: "Test",
    gmt_offset: "00:00:00",
    year: 2026,
    is_cancelled: false,
    ...over,
  };
}

describe("pickWeekendForRace", () => {
  const weekendA: Session[] = [
    session({
      session_type: "Practice",
      session_name: "FP1",
      date_start: "2026-06-05T13:30:00+00:00",
      meeting_key: 100,
    }),
    session({
      session_type: "Qualifying",
      session_name: "Qualifying",
      date_start: "2026-06-06T18:00:00+00:00",
      meeting_key: 100,
    }),
    session({
      session_type: "Race",
      session_name: "Race",
      date_start: "2026-06-07T18:00:00+00:00",
      meeting_key: 100,
    }),
  ];
  const weekendB: Session[] = [
    session({
      session_type: "Race",
      session_name: "Race",
      date_start: "2026-06-21T13:00:00+00:00",
      meeting_key: 200,
    }),
  ];

  it("returns only the matching weekend's sessions, sorted chronologically", () => {
    const out = pickWeekendForRace([...weekendB, ...weekendA], "2026-06-07");
    expect(out.map((s) => s.meeting_key)).toEqual([100, 100, 100]);
    expect(out.map((s) => s.session_name)).toEqual(["FP1", "Qualifying", "Race"]);
  });

  it("falls back to the nearest race when no exact date matches", () => {
    const out = pickWeekendForRace([...weekendA, ...weekendB], "2026-06-08");
    expect(out.every((s) => s.meeting_key === 100)).toBe(true);
  });

  it("ignores cancelled races and returns [] when there is no race", () => {
    const onlyPractice = [
      session({ session_type: "Practice", date_start: "2026-06-05T13:30:00+00:00" }),
    ];
    expect(pickWeekendForRace(onlyPractice, "2026-06-07")).toEqual([]);
    expect(pickWeekendForRace([], "2026-06-07")).toEqual([]);
  });
});
