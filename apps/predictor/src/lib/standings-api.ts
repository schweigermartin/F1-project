/**
 * Championship standings for the predictor hub — needed both as context (a
 * mini standings panel) and as the driver→constructor map that drives team
 * colours (`driverTeamColor`, @f1/shared). Free Jolpica API, server-side only
 * (no CORS header), Zod-validated, ISR-cached. Any failure → `null` so the
 * panel degrades instead of crashing the route.
 *
 * App-local fetch logic intentionally mirrors the dashboard's `f1-api.ts`
 * rather than sharing it (Constitution III scopes sharing to schemas/keys/
 * cross-cutting data like team colours — the two apps stay independent).
 */

import { z } from "zod";

const BASE = "https://api.jolpi.ca/ergast/f1";
const REVALIDATE_SECONDS = 3600;

const driverStandingsEnvelope = z.object({
  MRData: z.object({
    StandingsTable: z.object({
      StandingsLists: z
        .array(
          z.object({
            DriverStandings: z.array(
              z.object({
                position: z.string(),
                points: z.string(),
                wins: z.string(),
                Driver: z.object({
                  givenName: z.string(),
                  familyName: z.string(),
                  code: z.string().optional(),
                  nationality: z.string().optional(),
                }),
                Constructors: z.array(z.object({ name: z.string() })),
              }),
            ),
          }),
        )
        .min(1),
    }),
  }),
});

export interface DriverStanding {
  position: number;
  points: string;
  wins: string;
  name: string;
  code: string;
  constructor: string;
  nationality?: string;
}

export async function getDriverStandings(): Promise<DriverStanding[] | null> {
  try {
    const res = await fetch(`${BASE}/current/driverstandings/?format=json`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = driverStandingsEnvelope.safeParse(json);
    if (!parsed.success) return null;
    const list = parsed.data.MRData.StandingsTable.StandingsLists[0]?.DriverStandings;
    if (!list) return null;
    return list.map((s) => ({
      position: Number(s.position),
      points: s.points,
      wins: s.wins,
      name: `${s.Driver.givenName} ${s.Driver.familyName}`,
      code: s.Driver.code ?? s.Driver.familyName.slice(0, 3).toUpperCase(),
      constructor: s.Constructors[s.Constructors.length - 1]?.name ?? "—",
      ...(s.Driver.nationality ? { nationality: s.Driver.nationality } : {}),
    }));
  } catch {
    return null;
  }
}
