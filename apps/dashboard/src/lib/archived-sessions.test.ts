import type { Session } from "@f1/shared";
import { describe, expect, it } from "vitest";

import { archivedSessionLabel, toArchivedSessions } from "./archived-sessions";

function session(overrides: Partial<Session> = {}): Session {
  return {
    session_key: 9999,
    session_type: "Race",
    session_name: "Race",
    date_start: "2026-07-26T13:00:00+00:00",
    date_end: "2026-07-26T15:00:00+00:00",
    meeting_key: 1250,
    circuit_key: 10,
    circuit_short_name: "Hungaroring",
    country_key: 40,
    country_code: "HUN",
    country_name: "Hungary",
    location: "Budapest",
    gmt_offset: "02:00:00",
    year: 2026,
    is_cancelled: false,
    ...overrides,
  };
}

const NOW = new Date("2026-07-27T09:00:00Z");

describe("archivedSessionLabel", () => {
  it("renders country, session and day in German", () => {
    expect(archivedSessionLabel(session())).toBe("Ungarn — Rennen · 26.07.2026");
  });

  it("translates practice sessions", () => {
    expect(archivedSessionLabel(session({ session_name: "Practice 1" }))).toContain(
      "Freies Training 1",
    );
  });

  it("falls back to the raw names when a translation is missing", () => {
    const label = archivedSessionLabel(
      session({ country_name: "Atlantis", session_name: "Time Trial" }),
    );
    expect(label).toBe("Atlantis — Time Trial · 26.07.2026");
  });

  it("uses the reported local day, not the server timezone", () => {
    // 23:00 local on the 26th would slip to the 27th if parsed as a Date in UTC+X.
    const label = archivedSessionLabel(session({ date_start: "2026-07-26T23:00:00+08:00" }));
    expect(label).toContain("26.07.2026");
  });
});

describe("toArchivedSessions", () => {
  it("keeps only sessions that have already ended", () => {
    const past = session({ session_key: 1 });
    const running = session({
      session_key: 2,
      date_start: "2026-07-27T08:00:00+00:00",
      date_end: "2026-07-27T10:00:00+00:00",
    });
    const future = session({
      session_key: 3,
      date_start: "2026-08-23T13:00:00+00:00",
      date_end: "2026-08-23T15:00:00+00:00",
    });

    expect(toArchivedSessions([past, running, future], NOW).map((s) => s.session_key)).toEqual([1]);
  });

  it("drops cancelled sessions", () => {
    expect(toArchivedSessions([session({ is_cancelled: true })], NOW)).toEqual([]);
  });

  it("sorts newest first so the last session is the default", () => {
    const older = session({
      session_key: 1,
      date_start: "2026-07-19T13:00:00+00:00",
      date_end: "2026-07-19T15:00:00+00:00",
    });
    const newer = session({ session_key: 2 });

    expect(toArchivedSessions([older, newer], NOW).map((s) => s.session_key)).toEqual([2, 1]);
  });

  it("exposes key, day and raw session name alongside the label", () => {
    expect(toArchivedSessions([session()], NOW)[0]).toEqual({
      session_key: 9999,
      label: "Ungarn — Rennen · 26.07.2026",
      date: "2026-07-26",
      sessionName: "Race",
    });
  });

  it("returns [] rather than throwing on an unparsable end date", () => {
    expect(toArchivedSessions([session({ date_end: "not-a-date" })], NOW)).toEqual([]);
  });
});
