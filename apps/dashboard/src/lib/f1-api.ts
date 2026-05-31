/**
 * Season data from the Jolpica F1 API (the free, Ergast-compatible successor —
 * no API key). Fetched server-side only: Jolpica sends no CORS header, so a
 * browser fetch would be blocked, and server-side keeps it free + cached.
 *
 * Every response is Zod-validated (Constitution VI). Any failure (network,
 * non-200, shape drift) resolves to `null` so the page degrades to a friendly
 * "unavailable" state instead of crashing the build/route.
 *
 * ISR: each fetch revalidates hourly — standings/results only change after a
 * race, so this is fresh enough and stays well within Jolpica's rate limits.
 */

import { z } from "zod";

const BASE = "https://api.jolpi.ca/ergast/f1";
const REVALIDATE_SECONDS = 3600;

async function fetchJolpica<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ─── Raw Jolpica/Ergast envelope schemas (only the fields we use) ────────────

const DriverSchema = z.object({
  givenName: z.string(),
  familyName: z.string(),
  code: z.string().optional(),
  permanentNumber: z.string().optional(),
  nationality: z.string().optional(),
});

const ConstructorSchema = z.object({
  name: z.string(),
  nationality: z.string().optional(),
});

const driverStandingsEnvelope = z.object({
  MRData: z.object({
    StandingsTable: z.object({
      season: z.string().optional(),
      round: z.string().optional(),
      StandingsLists: z
        .array(
          z.object({
            DriverStandings: z.array(
              z.object({
                position: z.string(),
                points: z.string(),
                wins: z.string(),
                Driver: DriverSchema,
                Constructors: z.array(ConstructorSchema),
              }),
            ),
          }),
        )
        .min(1),
    }),
  }),
});

const constructorStandingsEnvelope = z.object({
  MRData: z.object({
    StandingsTable: z.object({
      StandingsLists: z
        .array(
          z.object({
            ConstructorStandings: z.array(
              z.object({
                position: z.string(),
                points: z.string(),
                wins: z.string(),
                Constructor: ConstructorSchema,
              }),
            ),
          }),
        )
        .min(1),
    }),
  }),
});

const RaceSchema = z.object({
  round: z.string(),
  raceName: z.string(),
  date: z.string(),
  time: z.string().optional(),
  Circuit: z.object({
    circuitName: z.string(),
    Location: z.object({ locality: z.string().optional(), country: z.string().optional() }),
  }),
});

const scheduleEnvelope = z.object({
  MRData: z.object({ RaceTable: z.object({ Races: z.array(RaceSchema) }) }),
});

const resultsEnvelope = z.object({
  MRData: z.object({
    RaceTable: z.object({
      Races: z.array(
        RaceSchema.extend({
          Results: z.array(
            z.object({
              position: z.string(),
              points: z.string(),
              grid: z.string().optional(),
              Driver: DriverSchema,
              Constructor: ConstructorSchema,
              Time: z.object({ time: z.string() }).optional(),
              status: z.string().optional(),
            }),
          ),
        }),
      ),
    }),
  }),
});

// ─── Clean output shapes the components render ───────────────────────────────

export interface DriverStanding {
  position: number;
  points: string;
  wins: string;
  name: string;
  code: string;
  constructor: string;
  nationality?: string;
}

export interface ConstructorStanding {
  position: number;
  points: string;
  wins: string;
  name: string;
  nationality?: string;
}

export interface RaceMeta {
  round: number;
  name: string;
  circuit: string;
  locality?: string;
  country?: string;
  date: string;
  /** ISO datetime if a time is given, else null. */
  startsAt: string | null;
}

export interface RaceResultRow {
  position: number;
  driver: string;
  code: string;
  constructor: string;
  points: string;
  grid?: string;
  result: string; // finishing time or status
  nationality?: string;
}

export interface LastRace {
  name: string;
  round: number;
  date: string;
  results: RaceResultRow[];
}

function toRaceMeta(r: z.infer<typeof RaceSchema>): RaceMeta {
  return {
    round: Number(r.round),
    name: r.raceName,
    circuit: r.Circuit.circuitName,
    ...(r.Circuit.Location.locality ? { locality: r.Circuit.Location.locality } : {}),
    ...(r.Circuit.Location.country ? { country: r.Circuit.Location.country } : {}),
    date: r.date,
    startsAt: r.time ? `${r.date}T${r.time}` : null,
  };
}

// ─── Public data accessors ───────────────────────────────────────────────────

export async function getDriverStandings(): Promise<DriverStanding[] | null> {
  const data = await fetchJolpica("current/driverstandings/?format=json", driverStandingsEnvelope);
  const list = data?.MRData.StandingsTable.StandingsLists[0]?.DriverStandings;
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
}

export async function getConstructorStandings(): Promise<ConstructorStanding[] | null> {
  const data = await fetchJolpica(
    "current/constructorstandings/?format=json",
    constructorStandingsEnvelope,
  );
  const list = data?.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings;
  if (!list) return null;
  return list.map((s) => ({
    position: Number(s.position),
    points: s.points,
    wins: s.wins,
    name: s.Constructor.name,
    ...(s.Constructor.nationality ? { nationality: s.Constructor.nationality } : {}),
  }));
}

export async function getSchedule(): Promise<RaceMeta[] | null> {
  const data = await fetchJolpica("current/?format=json", scheduleEnvelope);
  const races = data?.MRData.RaceTable.Races;
  if (!races) return null;
  return races.map(toRaceMeta);
}

export async function getLastResults(): Promise<LastRace | null> {
  const data = await fetchJolpica("current/last/results/?format=json", resultsEnvelope);
  const race = data?.MRData.RaceTable.Races[0];
  if (!race) return null;
  return {
    name: race.raceName,
    round: Number(race.round),
    date: race.date,
    results: race.Results.map((r) => ({
      position: Number(r.position),
      driver: `${r.Driver.givenName} ${r.Driver.familyName}`,
      code: r.Driver.code ?? r.Driver.familyName.slice(0, 3).toUpperCase(),
      constructor: r.Constructor.name,
      points: r.points,
      ...(r.grid ? { grid: r.grid } : {}),
      result: r.Time?.time ?? r.status ?? "—",
      ...(r.Driver.nationality ? { nationality: r.Driver.nationality } : {}),
    })),
  };
}

/**
 * Pure: the next race at-or-after `now` (by UTC date), else null if the season
 * is over. Split out so it's unit-testable without network.
 */
export function pickNextRace(races: RaceMeta[], now: Date): RaceMeta | null {
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  const upcoming = races
    .filter((r) => r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] ?? null;
}
