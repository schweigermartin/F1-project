import {
  CONN_PK_ATTR,
  CONN_SK_ATTR,
  CONN_TTL_ATTR,
  connMetaSK,
  connPK,
  connTtlEpochSeconds,
} from "@f1/shared";

/**
 * $connect logic. Pure DI — index.ts wires the real DDB client.
 *
 * One row per WebSocket connection in F1Connections. No session yet — the
 * client picks one with a `subscribe` message (T4). The 2h TTL is the safety
 * net for the common WebSocket failure mode: a $disconnect that never fires.
 *
 * Idempotent: a repeated $connect for the same id just overwrites the row.
 */

export interface ConnectEvent {
  connectionId: string;
}

export interface ConnectDeps {
  /** DDB PutItem-equivalent — receives a ready-to-go Item. */
  putConnection: (item: Record<string, unknown>) => Promise<void>;
  /** Wall-clock injection for connectedAt + TTL. */
  now: () => Date;
}

export function buildConnectionItem(connectionId: string, now: Date): Record<string, unknown> {
  return {
    [CONN_PK_ATTR]: connPK(connectionId),
    [CONN_SK_ATTR]: connMetaSK(),
    [CONN_TTL_ATTR]: connTtlEpochSeconds(now),
    connectionId,
    connectedAt: now.toISOString(),
  };
}

export async function handleConnect(event: ConnectEvent, deps: ConnectDeps): Promise<void> {
  await deps.putConnection(buildConnectionItem(event.connectionId, deps.now()));
}
