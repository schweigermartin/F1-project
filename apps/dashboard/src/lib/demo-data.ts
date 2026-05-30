import type { ServerMessage } from "@f1/shared";

/**
 * A canned snapshot so `next dev` (and a preview without a deployed backend)
 * shows a populated dashboard. Seeded only when NEXT_PUBLIC_WS_URL is unset.
 * Numbers are illustrative, not a real session.
 */
export const DEMO_SNAPSHOT: Extract<ServerMessage, { type: "snapshot" }> = {
  type: "snapshot",
  session_id: "demo",
  weather: {
    date: "2026-05-24T20:30:00.000+00:00",
    session_key: 0,
    meeting_key: 0,
    pressure: 1011,
    humidity: 38,
    wind_direction: 210,
    air_temperature: 26,
    track_temperature: 44,
    wind_speed: 3,
    rainfall: 0,
  },
  drivers: [
    d(1, 1, 0, 0, "MEDIUM", 12, 41, 78.213),
    d(16, 2, 1.842, 1.842, "MEDIUM", 12, 41, 78.401),
    d(44, 3, 5.117, 3.275, "HARD", 4, 41, 78.62),
    d(63, 4, 8.04, 2.923, "HARD", 6, 40, 78.88),
    d(81, 5, 12.6, 4.56, "SOFT", 2, 40, 78.74),
    d(4, 6, 18.9, 6.3, "MEDIUM", 15, 40, 79.05),
  ],
};

function d(
  driver_number: number,
  position: number,
  gap_to_leader: number,
  interval: number,
  compound: string,
  tyre_age: number,
  last_lap_number: number,
  last_lap_duration: number,
): Extract<ServerMessage, { type: "snapshot" }>["drivers"][number] {
  return {
    driver_number,
    position,
    gap_to_leader,
    interval,
    compound: compound as "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET" | "UNKNOWN",
    stint_number: 1,
    tyre_age,
    last_lap_number,
    last_lap_duration,
  };
}
