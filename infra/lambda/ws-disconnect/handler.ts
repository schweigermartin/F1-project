import { CONN_PK_ATTR, CONN_SK_ATTR, connMetaSK, connPK } from "@f1/shared";

/**
 * $disconnect logic. Pure DI — index.ts wires the real DDB client.
 *
 * Deletes the connection row. That deletion is *also* the replay abort
 * signal: the replay λ (T6) checks the connection row before every batch and
 * stops the moment it's gone — so a dropped client can't keep a replay chain
 * alive (plan §6, R-3). Idempotent: deleting an absent row is a no-op.
 */

export interface DisconnectEvent {
  connectionId: string;
}

export interface DisconnectDeps {
  /** DDB DeleteItem-equivalent — receives the primary key. */
  deleteConnection: (key: Record<string, unknown>) => Promise<void>;
}

export function connectionKey(connectionId: string): Record<string, unknown> {
  return {
    [CONN_PK_ATTR]: connPK(connectionId),
    [CONN_SK_ATTR]: connMetaSK(),
  };
}

export async function handleDisconnect(
  event: DisconnectEvent,
  deps: DisconnectDeps,
): Promise<void> {
  await deps.deleteConnection(connectionKey(event.connectionId));
}
