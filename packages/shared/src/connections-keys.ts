/**
 * DynamoDB key helpers for the F1Connections table (Phase 2 plan §7).
 *
 *   PK = conn#<connectionId>
 *   SK = meta
 *
 * Separate table from F1Live (different lifecycle — connections are ephemeral
 * session-tracking, not race data; Constitution III keeps the shared base
 * clean). Attribute names intentionally match F1Live's for consistency, but
 * are declared here so a rename can't drift across the two tables.
 */

export const CONN_PK_ATTR = "PK" as const;
export const CONN_SK_ATTR = "SK" as const;
export const CONN_TTL_ATTR = "expiresAt" as const;

export const CONN_PK_PREFIX = "conn" as const;

export function connPK(connectionId: string): string {
  return `${CONN_PK_PREFIX}#${connectionId}`;
}

/** One row per connection. */
export function connMetaSK(): string {
  return "meta";
}

/**
 * Connections evict after 2h — long enough for any realistic session/replay,
 * short enough that a missed $disconnect (the common WebSocket failure mode)
 * never leaves a stale row that the fanout would keep posting to.
 */
export const CONNECTION_TTL_SECONDS = 2 * 60 * 60;

export function connTtlEpochSeconds(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000) + CONNECTION_TTL_SECONDS;
}
