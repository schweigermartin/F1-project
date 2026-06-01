/**
 * Resolves *which* race the landing page shows: the next race at-or-after today
 * (or, once the season is over, the most recent one). Read from the free
 * Jolpica/Ergast schedule — `round` there is the official championship round,
 * which matches the round our inference λ stamps onto each prediction.
 *
 * Server-side only and Zod-validated; any failure resolves to `null` so the
 * page shows an empty state rather than crashing. (Light overlap with the
 * dashboard's Jolpica client is intentional — the two apps stay independent;
 * only cross-cutting schema/keys live in @f1/shared, Constitution III.)
 */

import { z } from "zod";

const BASE = "https://api.jolpi.ca/ergast/f1";
const REVALIDATE_SECONDS = 3600;

const scheduleEnvelope = z.object({
  MRData: z.object({
    RaceTable: z.object({
      Races: z.array(z.object({ round: z.string(), date: z.string(), raceName: z.string() })),
    }),
  }),
});

export interface ScheduledRace {
  round: number;
  date: string; // YYYY-MM-DD
  name: string;
}

export async function getSeasonSchedule(): Promise<ScheduledRace[] | null> {
  try {
    const res = await fetch(`${BASE}/current/?format=json`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = scheduleEnvelope.safeParse(json);
    if (!parsed.success) return null;
    return parsed.data.MRData.RaceTable.Races.map((r) => ({
      round: Number(r.round),
      date: r.date,
      name: r.raceName,
    }));
  } catch {
    return null;
  }
}

/** Next race at-or-after `now`; once the season ends, the last race. Pure. */
export function pickTargetRace(races: ScheduledRace[], now: Date): ScheduledRace | null {
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  const upcoming = races
    .filter((r) => r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] ?? races[races.length - 1] ?? null;
}
