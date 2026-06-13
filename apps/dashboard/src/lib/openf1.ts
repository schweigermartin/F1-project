/**
 * OpenF1 access for the Season Explorer's practice sessions (Phase 8). Jolpica
 * has no practice classification, so for FP1–FP3 we derive the fastest lap per
 * driver from OpenF1 `/laps` and label drivers via `/drivers`. Server-side,
 * Zod-validated (shared schemas where possible), best-effort: any gap → `null`
 * and the board shows a friendly note (Constitution V/VI).
 */

import { type Lap, LapSchema, type Session, SessionSchema } from "@f1/shared";
import { z } from "zod";

const BASE = "https://api.openf1.org/v1";
const REVALIDATE_SECONDS = 60 * 60 * 24; // sessions are historical → cache long.

const SessionsArray = z.array(SessionSchema);
const LapsArray = z.array(LapSchema);

const DriverSchema = z.object({
  driver_number: z.number().int(),
  name_acronym: z.string().optional(),
  full_name: z.string().optional(),
  team_name: z.string().optional(),
});
const DriversArray = z.array(DriverSchema);

/** All sessions of the meeting that contains `raceDate` (same logic as predictor). */
export async function getMeetingSessions(race: {
  date: string;
  country?: string;
}): Promise<Session[]> {
  try {
    const url = new URL(`${BASE}/sessions`);
    url.searchParams.set("year", race.date.slice(0, 4));
    if (race.country) url.searchParams.set("country_name", race.country);
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const parsed = SessionsArray.safeParse(json);
    if (!parsed.success) return [];
    const races = parsed.data.filter((s) => s.session_type === "Race" && !s.is_cancelled);
    const target = new Date(`${race.date}T12:00:00Z`).getTime();
    const raceSession =
      races.find((s) => s.date_start.slice(0, 10) === race.date) ??
      races
        .map((s) => ({ s, d: Math.abs(new Date(s.date_start).getTime() - target) }))
        .sort((a, b) => a.d - b.d)[0]?.s;
    if (!raceSession) return [];
    return parsed.data
      .filter((s) => s.meeting_key === raceSession.meeting_key && !s.is_cancelled)
      .sort((a, b) => a.date_start.localeCompare(b.date_start));
  } catch {
    return [];
  }
}

/** Pure: fastest valid lap per driver, ascending. Ignores null/in-progress laps. */
export function fastestPerDriver(laps: Lap[]): Array<{ driver_number: number; lap: number }> {
  const best = new Map<number, number>();
  for (const l of laps) {
    if (l.lap_duration === null || l.is_pit_out_lap) continue;
    const prev = best.get(l.driver_number);
    if (prev === undefined || l.lap_duration < prev) best.set(l.driver_number, l.lap_duration);
  }
  return [...best.entries()]
    .map(([driver_number, lap]) => ({ driver_number, lap }))
    .sort((a, b) => a.lap - b.lap);
}

export interface FastLapRow {
  position: number;
  driver_number: number;
  code: string;
  constructor: string;
  /** Lap time formatted m:ss.mmm. */
  time: string;
  /** Gap to fastest, e.g. "+0.214" (empty for P1). */
  gap: string;
}

function fmtLap(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, "0");
  return m > 0 ? `${m}:${s}` : s;
}

/** Practice classification (fastest lap per driver) for one OpenF1 session. */
export async function getPracticeFastestLaps(sessionKey: number): Promise<FastLapRow[] | null> {
  try {
    const [lapsRes, driversRes] = await Promise.all([
      fetch(`${BASE}/laps?session_key=${sessionKey}`, {
        next: { revalidate: REVALIDATE_SECONDS },
        headers: { Accept: "application/json" },
      }),
      fetch(`${BASE}/drivers?session_key=${sessionKey}`, {
        next: { revalidate: REVALIDATE_SECONDS },
        headers: { Accept: "application/json" },
      }),
    ]);
    if (!lapsRes.ok) return null;
    const laps = LapsArray.safeParse(await lapsRes.json());
    if (!laps.success) return null;
    const ranked = fastestPerDriver(laps.data);
    if (ranked.length === 0) return null;

    const driverMap = new Map<number, z.infer<typeof DriverSchema>>();
    if (driversRes.ok) {
      const drivers = DriversArray.safeParse(await driversRes.json());
      if (drivers.success) for (const d of drivers.data) driverMap.set(d.driver_number, d);
    }
    const fastest = ranked[0]?.lap ?? 0;
    return ranked.map((r, i) => {
      const d = driverMap.get(r.driver_number);
      return {
        position: i + 1,
        driver_number: r.driver_number,
        code: d?.name_acronym ?? `#${r.driver_number}`,
        constructor: d?.team_name ?? "—",
        time: fmtLap(r.lap),
        gap: i === 0 ? "" : `+${(r.lap - fastest).toFixed(3)}`,
      };
    });
  } catch {
    return null;
  }
}
