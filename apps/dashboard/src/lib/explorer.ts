/**
 * Pure selection logic for the Season Explorer (Phase 8). Kept out of the
 * server component so URL-param resolution, session options and driver-focus
 * derivation are unit-tested without rendering or network.
 */

import { type DriverStanding, pickNextRace, type RaceMeta, type RaceResultRow } from "./f1-api";

export type SessionKey = "race" | "qualifying" | "fp1" | "fp2" | "fp3";

export interface SessionOption {
  key: SessionKey;
  label: string;
  /** OpenF1 `session_name` for practice (used to find the session_key). */
  openF1Name?: string;
}

export const SESSION_OPTIONS: SessionOption[] = [
  { key: "race", label: "Rennen" },
  { key: "qualifying", label: "Qualifying", openF1Name: "Qualifying" },
  { key: "fp3", label: "FP3", openF1Name: "Practice 3" },
  { key: "fp2", label: "FP2", openF1Name: "Practice 2" },
  { key: "fp1", label: "FP1", openF1Name: "Practice 1" },
];

const SESSION_KEYS = new Set<string>(SESSION_OPTIONS.map((o) => o.key));

export function isSessionKey(value: string | undefined): value is SessionKey {
  return value !== undefined && SESSION_KEYS.has(value);
}

export function sessionLabel(key: SessionKey): string {
  return SESSION_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export interface Selection {
  round: number;
  session: SessionKey;
  driver: string | null;
  race: RaceMeta | null;
}

/**
 * Resolve `round`/`session`/`driver` from raw URL params against the schedule.
 * Invalid/missing values fall back to defaults (next-or-last race, `race`,
 * no focus) so a hand-edited URL never crashes the page.
 */
export function resolveSelection(
  params: { round?: string | undefined; session?: string | undefined; driver?: string | undefined },
  schedule: RaceMeta[] | null,
  now: Date,
): Selection {
  const races = schedule ?? [];
  const defaultRace = pickNextRace(races, now) ?? races[races.length - 1] ?? null;

  const requested = params.round ? Number(params.round) : NaN;
  const race =
    (Number.isInteger(requested) ? races.find((r) => r.round === requested) : undefined) ??
    defaultRace;

  const session: SessionKey = isSessionKey(params.session) ? params.session : "race";
  const driver = params.driver && params.driver.trim() ? params.driver.trim().toUpperCase() : null;

  return { round: race?.round ?? 0, session, driver, race };
}

export interface DriverFocus {
  code: string;
  name: string;
  constructor: string;
  championshipPos: number | null;
  points: string | null;
  wins: string | null;
  raceResult: { position: number; result: string; points: string; grid?: string } | null;
}

/**
 * Build the driver-focus card data from already-loaded standings + race rows —
 * no extra fetch (spec D-3). Returns `null` if the code matches nothing.
 */
export function buildDriverFocus(
  code: string,
  standings: DriverStanding[] | null,
  raceRows: RaceResultRow[] | null,
): DriverFocus | null {
  const standing = standings?.find((s) => s.code === code) ?? null;
  const row = raceRows?.find((r) => r.code === code) ?? null;
  if (!standing && !row) return null;
  return {
    code,
    name: standing?.name ?? row?.driver ?? code,
    constructor: standing?.constructor ?? row?.constructor ?? "—",
    championshipPos: standing ? standing.position : null,
    points: standing ? standing.points : null,
    wins: standing ? standing.wins : null,
    raceResult: row
      ? {
          position: row.position,
          result: row.result,
          points: row.points,
          ...(row.grid ? { grid: row.grid } : {}),
        }
      : null,
  };
}
