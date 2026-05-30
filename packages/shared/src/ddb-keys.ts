/**
 * DynamoDB Single-Table key helpers (Phase 1 plan §7 — F1LiveTable).
 *
 *   PK = session#<session_id>
 *   SK = <entity>#<...>
 *
 * One module so PK/SK construction is never written by hand — typos in keys
 * cause silent reads-that-find-nothing, which is the worst failure mode.
 */

/**
 * Attribute names of the Single-Table. The CDK stack (T5) declares these,
 * the Consumer lambda (T8) reads/writes them — keep them in one place so
 * a rename can't drift across the codebase.
 */
export const PK_ATTR = "PK" as const;
export const SK_ATTR = "SK" as const;
export const TTL_ATTR = "expiresAt" as const;

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

/**
 * Build the SK for a single row of an endpoint payload. Returning `null`
 * means "this row doesn't get its own DDB item" — the only current case is
 * a row that lacks a `driver_number` or other required key field.
 */
export type EndpointRow = Record<string, unknown>;

export function rowToSK(endpoint: string, row: EndpointRow): string | null {
  switch (endpoint) {
    case "position":
      return typeof row["driver_number"] === "number"
        ? driverPositionSK(row["driver_number"])
        : null;
    case "intervals":
      return typeof row["driver_number"] === "number"
        ? driverIntervalSK(row["driver_number"])
        : null;
    case "laps":
      if (typeof row["driver_number"] === "number" && typeof row["lap_number"] === "number") {
        return lapSK(row["driver_number"], row["lap_number"]);
      }
      return null;
    case "stints":
      if (typeof row["driver_number"] === "number" && typeof row["stint_number"] === "number") {
        return stintSK(row["driver_number"], row["stint_number"]);
      }
      return null;
    case "weather":
      return weatherSK();
    default:
      return null;
  }
}

/**
 * Inverse of the SK builders: derive the live-entity kind from an SK. Used by
 * the fanout λ (Phase 2) to turn a DDB-stream image into a typed `delta`.
 * Returns `null` for rows that don't map to a pushable entity (e.g. `meta`).
 *
 * The returned strings match the DELTA_ENTITIES set in ws-messages — kept as
 * a plain string here so ddb-keys stays free of the ws-messages import; the
 * caller validates against DeltaEntitySchema.
 */
export function skToEntity(sk: string): string | null {
  if (sk.endsWith("#position")) return "position";
  if (sk.endsWith("#interval")) return "interval";
  if (sk.startsWith("lap#")) return "lap";
  if (sk.startsWith("stint#")) return "stint";
  if (sk.startsWith("weather#")) return "weather";
  return null;
}
