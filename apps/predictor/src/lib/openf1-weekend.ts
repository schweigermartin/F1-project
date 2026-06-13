/**
 * OpenF1 data for the weekend hub: the session schedule (FP/Quali/Sprint/Race
 * with real start times), live weather and live positions. `/sessions` is
 * fetched server-side (ISR) for the timeline; the live helpers are called from
 * the client poll island and only while a race session is active
 * (Constitution IV — no 24/7 polling).
 *
 * Every response is Zod-validated against the shared OpenF1 schemas
 * (Constitution VI). Any failure resolves to an empty/`null` result so each
 * panel degrades on its own.
 */

import {
  PositionSchema,
  SessionSchema,
  WeatherSchema,
  type Position,
  type Session,
  type Weather,
} from "@f1/shared";
import { z } from "zod";

const BASE = "https://api.openf1.org/v1";
const REVALIDATE_SECONDS = 3600;

const SessionsArray = z.array(SessionSchema);
const WeatherArray = z.array(WeatherSchema);
const PositionArray = z.array(PositionSchema);

/**
 * Pure: pick the sessions that belong to `raceDate`'s weekend. We find the
 * meeting that contains the Race on (or nearest to) that date, then return all
 * of that meeting's sessions in chronological order. Date-only comparison in
 * UTC is enough — a meeting never spans a month boundary in practice.
 */
export function pickWeekendForRace(sessions: Session[], raceDate: string): Session[] {
  if (sessions.length === 0) return [];
  const races = sessions.filter((s) => s.session_type === "Race" && !s.is_cancelled);
  // Race whose start date matches, else the race closest in time to raceDate.
  const target = new Date(`${raceDate}T12:00:00Z`).getTime();
  const raceSession =
    races.find((s) => s.date_start.slice(0, 10) === raceDate) ??
    races
      .map((s) => ({ s, d: Math.abs(new Date(s.date_start).getTime() - target) }))
      .sort((a, b) => a.d - b.d)[0]?.s;
  if (!raceSession) return [];
  return sessions
    .filter((s) => s.meeting_key === raceSession.meeting_key && !s.is_cancelled)
    .sort((a, b) => a.date_start.localeCompare(b.date_start));
}

/** All sessions of the target race's weekend (server, ISR). */
export async function getWeekendSessions(race: {
  date: string;
  country?: string;
}): Promise<Session[]> {
  try {
    const year = race.date.slice(0, 4);
    const url = new URL(`${BASE}/sessions`);
    url.searchParams.set("year", year);
    if (race.country) url.searchParams.set("country_name", race.country);
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const parsed = SessionsArray.safeParse(json);
    if (!parsed.success) return [];
    return pickWeekendForRace(parsed.data, race.date);
  } catch {
    return [];
  }
}

/** Latest live weather tick for an active session (client poll). */
export async function getLiveWeather(sessionKey: number): Promise<Weather | null> {
  try {
    const res = await fetch(`${BASE}/weather?session_key=${sessionKey}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = WeatherArray.safeParse(json);
    if (!parsed.success || parsed.data.length === 0) return null;
    return parsed.data[parsed.data.length - 1] ?? null;
  } catch {
    return null;
  }
}

/** Latest position per driver for an active session (client poll). */
export async function getLivePositions(sessionKey: number): Promise<Position[]> {
  try {
    const res = await fetch(`${BASE}/position?session_key=${sessionKey}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const parsed = PositionArray.safeParse(json);
    if (!parsed.success) return [];
    // Keep the latest tick per driver (OpenF1 returns the full position history).
    const latest = new Map<number, Position>();
    for (const p of parsed.data) latest.set(p.driver_number, p);
    return [...latest.values()].sort((a, b) => a.position - b.position);
  } catch {
    return [];
  }
}
