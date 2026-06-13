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
      Races: z.array(
        z.object({
          round: z.string(),
          date: z.string(),
          time: z.string().optional(),
          raceName: z.string(),
          Circuit: z
            .object({
              circuitId: z.string(),
              circuitName: z.string(),
              Location: z.object({
                lat: z.string().optional(),
                long: z.string().optional(),
                locality: z.string().optional(),
                country: z.string().optional(),
              }),
            })
            .optional(),
        }),
      ),
    }),
  }),
});

export interface ScheduledRace {
  round: number;
  date: string; // YYYY-MM-DD
  name: string;
  /** ISO datetime if Jolpica gives the race start time, else null. */
  startsAt?: string | null;
  /** Circuit metadata (for the weekend hub: map, weather, history). */
  circuitId?: string;
  circuit?: string;
  locality?: string;
  country?: string;
  lat?: number;
  lon?: number;
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
    return parsed.data.MRData.RaceTable.Races.map((r) => {
      const loc = r.Circuit?.Location;
      const lat = loc?.lat ? Number(loc.lat) : undefined;
      const lon = loc?.long ? Number(loc.long) : undefined;
      return {
        round: Number(r.round),
        date: r.date,
        name: r.raceName,
        startsAt: r.time ? `${r.date}T${r.time}` : null,
        ...(r.Circuit ? { circuitId: r.Circuit.circuitId, circuit: r.Circuit.circuitName } : {}),
        ...(loc?.locality ? { locality: loc.locality } : {}),
        ...(loc?.country ? { country: loc.country } : {}),
        ...(lat !== undefined && !Number.isNaN(lat) ? { lat } : {}),
        ...(lon !== undefined && !Number.isNaN(lon) ? { lon } : {}),
      };
    });
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
