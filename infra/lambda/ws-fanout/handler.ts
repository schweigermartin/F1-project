import {
  DeltaEntitySchema,
  PK_ATTR,
  PK_PREFIX,
  type ServerMessage,
  SK_ATTR,
  skToEntity,
  TTL_ATTR,
} from "@f1/shared";

/**
 * Fanout logic. Pure DI — index.ts wires the DDB-stream source, the
 * connections lookup, and the ApiGw management client.
 *
 * Per F1Live stream record (NEW_IMAGE only):
 *   1. Turn the image into a typed `delta` (session_id from PK, entity from
 *      SK via @f1/shared, data = the row minus DDB-internal attrs).
 *   2. Look up every connection subscribed to that session (once per session
 *      per batch) and PostToConnection the delta.
 *
 * Failure model:
 *   - A dead connection (410 Gone) is deleted, NOT retried — it must never
 *     fail the batch, or one stale browser would block the whole stream.
 *   - Anything else bubbles up so the stream source retries the batch.
 *   - No subscribers → no-op (the common case; cheap).
 */

const DDB_INTERNAL_ATTRS = new Set<string>([PK_ATTR, SK_ATTR, TTL_ATTR]);

export interface FanoutRecord {
  eventName: "INSERT" | "MODIFY" | "REMOVE";
  /** Unmarshalled NEW_IMAGE; absent on REMOVE. */
  newImage?: Record<string, unknown>;
}

export interface FanoutEvent {
  Records: FanoutRecord[];
}

/** Thrown-error shape index.ts maps a 410 onto. */
export interface FanoutDeps {
  /** connectionIds subscribed to a session. */
  listConnections: (sessionId: string) => Promise<string[]>;
  /** PostToConnection; reject with `{ gone: true }` for a 410. */
  post: (connectionId: string, message: ServerMessage) => Promise<void>;
  /** Remove a dead connection row. */
  deleteConnection: (connectionId: string) => Promise<void>;
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export interface DeltaWithSession {
  session_id: string;
  message: Extract<ServerMessage, { type: "delta" }>;
}

function isGone(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "gone" in err &&
    (err as { gone?: unknown }).gone === true
  );
}

/** Image → delta, or null if the image isn't a pushable per-entity row. */
export function imageToDelta(image: Record<string, unknown>): DeltaWithSession | null {
  const pk = image[PK_ATTR];
  const sk = image[SK_ATTR];
  if (typeof pk !== "string" || typeof sk !== "string") return null;
  if (!pk.startsWith(`${PK_PREFIX}#`)) return null;

  const entityRaw = skToEntity(sk);
  const entity = DeltaEntitySchema.safeParse(entityRaw);
  if (!entity.success) return null;

  const session_id = pk.slice(PK_PREFIX.length + 1);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(image)) {
    if (!DDB_INTERNAL_ATTRS.has(k)) data[k] = v;
  }

  return {
    session_id,
    message: { type: "delta", session_id, entity: entity.data, data },
  };
}

export interface FanoutResult {
  deltas: number;
  posted: number;
  gone: number;
}

export async function fanout(event: FanoutEvent, deps: FanoutDeps): Promise<FanoutResult> {
  // Group deltas by session so the connection lookup runs once per session.
  const bySession = new Map<string, DeltaWithSession["message"][]>();
  for (const record of event.Records) {
    if (record.eventName === "REMOVE" || !record.newImage) continue;
    const delta = imageToDelta(record.newImage);
    if (!delta) continue;
    const list = bySession.get(delta.session_id) ?? [];
    list.push(delta.message);
    bySession.set(delta.session_id, list);
  }

  let posted = 0;
  let gone = 0;
  let deltaCount = 0;

  for (const [sessionId, messages] of bySession) {
    deltaCount += messages.length;
    const connections = await deps.listConnections(sessionId);
    if (connections.length === 0) continue;

    for (const connectionId of connections) {
      for (const message of messages) {
        try {
          await deps.post(connectionId, message);
          posted += 1;
        } catch (err) {
          if (isGone(err)) {
            gone += 1;
            await deps.deleteConnection(connectionId);
            break; // stop posting to this dead connection
          }
          throw err; // real error → let the stream source retry the batch
        }
      }
    }
  }

  if (gone > 0) deps.emitMetric("FanoutGoneConnections", gone);
  deps.emitMetric("FanoutPosted", posted);
  return { deltas: deltaCount, posted, gone };
}
