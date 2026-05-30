/**
 * DynamoDB Single-Table key helpers (Phase 1 plan §7 — F1LiveTable).
 *
 *   PK = session#<session_id>
 *   SK = <entity>#<...>
 *
 * One module so PK/SK construction is never written by hand — typos in keys
 * cause silent reads-that-find-nothing, which is the worst failure mode.
 */

export const PK_PREFIX = "session" as const;

export function sessionPK(sessionId: string): string {
  return `${PK_PREFIX}#${sessionId}`;
}

/** Per-session metadata (one row per session). */
export function metaSK(): string {
  return "meta";
}

/** Latest known position for a driver — overwritten on every tick. */
export function driverPositionSK(driverNumber: number): string {
  return `driver#${driverNumber}#position`;
}

/** Latest gap/interval row for a driver — overwritten on every tick. */
export function driverIntervalSK(driverNumber: number): string {
  return `driver#${driverNumber}#interval`;
}

/** Individual lap row, lap_number zero-padded to keep SK-range scans sorted. */
export function lapSK(driverNumber: number, lapNumber: number): string {
  return `lap#${driverNumber}#${lapNumber.toString().padStart(4, "0")}`;
}

/** Stint row, stint_number zero-padded for the same reason as laps. */
export function stintSK(driverNumber: number, stintNumber: number): string {
  return `stint#${driverNumber}#${stintNumber.toString().padStart(2, "0")}`;
}

/** Weather snapshot — overwritten on every weather tick (one current value). */
export function weatherSK(): string {
  return "weather#current";
}

/**
 * TTL helper — every live row gets evicted after 24h. The archive in S3 is
 * the durable copy; DDB is just the hot-state cache.
 */
export const LIVE_TTL_SECONDS = 24 * 60 * 60;

export function ttlEpochSeconds(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000) + LIVE_TTL_SECONDS;
}
