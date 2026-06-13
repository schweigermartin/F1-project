import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEMO_RACE, DEMO_SESSIONS } from "../../lib/demo-data";
import { SessionTimeline } from "./SessionTimeline";

afterEach(cleanup);

describe("SessionTimeline", () => {
  it("renders every weekend session with a localized label", () => {
    render(
      <SessionTimeline
        sessions={DEMO_SESSIONS}
        race={DEMO_RACE}
        now={new Date("2026-06-01T00:00:00Z")}
      />,
    );
    expect(screen.getByText("Freies Training 1")).toBeDefined();
    expect(screen.getByText("Qualifying")).toBeDefined();
    expect(screen.getByText("Rennen")).toBeDefined();
  });

  it("falls back to the race day when no sessions are available (AC-2)", () => {
    render(
      <SessionTimeline sessions={[]} race={DEMO_RACE} now={new Date("2026-06-01T00:00:00Z")} />,
    );
    expect(screen.getByText(/Detaillierter Zeitplan noch nicht verfügbar/)).toBeDefined();
  });

  it("marks the running session as live", () => {
    // 20:15 UTC on Saturday → Qualifying (20:00–21:00) is live.
    render(
      <SessionTimeline
        sessions={DEMO_SESSIONS}
        race={DEMO_RACE}
        now={new Date("2026-06-06T20:15:00Z")}
      />,
    );
    expect(screen.getByText(/· live/)).toBeDefined();
  });
});
