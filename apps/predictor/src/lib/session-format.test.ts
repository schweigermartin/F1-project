import type { Session } from "@f1/shared";
import { describe, expect, it } from "vitest";

import { formatSessionTime, pickNextSession, sessionStatus } from "./session-format";

function s(name: string, start: string, end: string): Session {
  return {
    session_key: 1,
    session_type: name === "Race" ? "Race" : "Practice",
    session_name: name,
    date_start: start,
    date_end: end,
    meeting_key: 1,
    circuit_key: 1,
    circuit_short_name: "X",
    country_key: 1,
    country_code: "X",
    country_name: "X",
    location: "X",
    gmt_offset: "00:00:00",
    year: 2026,
    is_cancelled: false,
  };
}

const fp1 = s("FP1", "2026-06-05T13:00:00+00:00", "2026-06-05T14:00:00+00:00");
const quali = s("Qualifying", "2026-06-06T18:00:00+00:00", "2026-06-06T19:00:00+00:00");
const race = s("Race", "2026-06-07T18:00:00+00:00", "2026-06-07T20:00:00+00:00");

describe("sessionStatus", () => {
  it("classifies past / live / upcoming from the time window", () => {
    expect(sessionStatus(quali, new Date("2026-06-05T00:00:00Z"))).toBe("upcoming");
    expect(sessionStatus(quali, new Date("2026-06-06T18:30:00Z"))).toBe("live");
    expect(sessionStatus(quali, new Date("2026-06-08T00:00:00Z"))).toBe("past");
  });
});

describe("pickNextSession", () => {
  it("prefers a live session, then the earliest upcoming", () => {
    const list = [fp1, quali, race];
    expect(pickNextSession(list, new Date("2026-06-06T18:30:00Z"))?.session_name).toBe(
      "Qualifying",
    );
    expect(pickNextSession(list, new Date("2026-06-05T00:00:00Z"))?.session_name).toBe("FP1");
  });

  it("returns null once the weekend is over", () => {
    expect(pickNextSession([fp1, quali, race], new Date("2026-06-08T00:00:00Z"))).toBeNull();
  });
});

describe("formatSessionTime", () => {
  it("formats weekday + time in a fixed zone deterministically", () => {
    // 18:00 UTC on Saturday 2026-06-06.
    const out = formatSessionTime("2026-06-06T18:00:00+00:00", "UTC");
    expect(out).toContain("Sa");
    expect(out).toContain("18:00");
  });
});
