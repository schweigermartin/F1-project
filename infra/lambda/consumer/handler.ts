import {
  ENDPOINT_PAYLOAD_SCHEMAS,
  type EndpointRow,
  type OpenF1DataEndpoint,
  PIPELINE_EVENT_SCHEMA_VERSION,
  PipelineEventSchema,
  PK_ATTR,
  rowToSK,
  S3_PATHS,
  sessionPK,
  SK_ATTR,
  TTL_ATTR,
  ttlEpochSeconds,
} from "@f1/shared";

/**
 * Consumer logic. Pure DI — index.ts wires real AWS clients.
 *
 * Per SQS batch:
 *   1. Parse + validate each record against PipelineEventSchema, then
 *      against the per-endpoint payload schema (defense in depth; the
 *      Poller already validated, but a partial deploy may have a stale
 *      Poller producing v2 messages that we reject here).
 *   2. Fan rows into DDB items (one per row) using rowToSK() from shared.
 *      Skip rows we can't key (e.g. missing driver_number) — emit metric
 *      but don't fail the message.
 *   3. Buffer one JSONL line per record and PUT a single part-object to
 *      S3 at the end of the invocation: one part per batch, not per
 *      record, to keep S3 PUT count low (plan §5).
 *
 * Failure model:
 *   - Schema-fail (envelope OR payload) → message returned in batchItemFailures.
 *     SQS retries up to maxReceiveCount=3, then DLQ.
 *   - DDB or S3 throw → ALL messages in the batch return as failures.
 *     SQS retries the whole batch.
 */

export interface SQSMessage {
  messageId: string;
  body: string;
}

export interface ConsumerEvent {
  Records: SQSMessage[];
}

export interface BatchItemFailure {
  itemIdentifier: string;
}

export interface ConsumerDeps {
  /** DDB BatchWriteItem-equivalent. Receives ready-to-go Item objects. */
  putItems: (items: Array<Record<string, unknown>>) => Promise<void>;
  /** S3 PutObject — receives key + body string. */
  putObject: (key: string, body: string) => Promise<void>;
  /** Wall-clock injection for TTL + part-key timestamp. */
  now: () => Date;
  /** Idempotent unique-ish suffix for the part key (UUID in prod). */
  partSuffix: () => string;
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export interface ConsumerResult {
  batchItemFailures: BatchItemFailure[];
  written: number;
  archived: number;
}

interface ParsedRecord {
  messageId: string;
  session_id: string;
  endpoint: OpenF1DataEndpoint;
  fetched_at: string;
  rows: EndpointRow[];
  raw: string;
}

function parseRecord(record: SQSMessage): ParsedRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(record.body);
  } catch {
    return null;
  }

  const envelope = PipelineEventSchema.safeParse(json);
  if (!envelope.success || envelope.data.schema_version !== PIPELINE_EVENT_SCHEMA_VERSION) {
    return null;
  }

  const payloadSchema = ENDPOINT_PAYLOAD_SCHEMAS[envelope.data.endpoint];
  const payload = payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return null;
  }

  return {
    messageId: record.messageId,
    session_id: envelope.data.session_id,
    endpoint: envelope.data.endpoint,
    fetched_at: envelope.data.fetched_at,
    rows: payload.data as EndpointRow[],
    raw: record.body,
  };
}

function rowToDdbItem(
  session_id: string,
  endpoint: OpenF1DataEndpoint,
  row: EndpointRow,
  ttl: number,
): Record<string, unknown> | null {
  const sk = rowToSK(endpoint, row);
  if (!sk) return null;
  return {
    [PK_ATTR]: sessionPK(session_id),
    [SK_ATTR]: sk,
    [TTL_ATTR]: ttl,
    endpoint,
    ...row,
  };
}

export async function consumeBatch(
  event: ConsumerEvent,
  deps: ConsumerDeps,
): Promise<ConsumerResult> {
  const now = deps.now();
  const ttl = ttlEpochSeconds(now);
  const failures: BatchItemFailure[] = [];
  const parsed: ParsedRecord[] = [];

  // 1. Parse + validate. Schema-failures go straight to failures (→ DLQ).
  for (const record of event.Records) {
    const p = parseRecord(record);
    if (!p) {
      failures.push({ itemIdentifier: record.messageId });
      deps.emitMetric("SchemaValidationFailure", 1, { stage: "consumer" });
      continue;
    }
    parsed.push(p);
  }

  if (parsed.length === 0) {
    return { batchItemFailures: failures, written: 0, archived: 0 };
  }

  // 2. Fan out to DDB items.
  const items: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const p of parsed) {
    for (const row of p.rows) {
      const item = rowToDdbItem(p.session_id, p.endpoint, row, ttl);
      if (item) items.push(item);
      else skipped += 1;
    }
  }
  if (skipped > 0) deps.emitMetric("ConsumerUnroutedRows", skipped);

  // 3. Write — DDB then S3. If anything throws, EVERY message in the
  // batch returns as failed and SQS retries the lot. The Consumer is
  // designed to be idempotent (PK/SK overwrite, S3 part key unique).
  try {
    if (items.length > 0) {
      await deps.putItems(items);
    }
    const partKey = S3_PATHS.rawSessionPart(
      now.toISOString().slice(0, 10),
      parsed[0]!.session_id,
      now.toISOString(),
      deps.partSuffix(),
    );
    const body = parsed.map((p) => p.raw).join("\n") + "\n";
    await deps.putObject(partKey, body);
    deps.emitMetric("EventsArchived", parsed.length);

    return { batchItemFailures: failures, written: items.length, archived: parsed.length };
  } catch (err) {
    deps.emitMetric("ConsumerWriteFailure", 1);
    // Bubble up entire-batch failure: report ALL parsed messages back
    // (the already-collected schema failures stay too).
    for (const p of parsed) failures.push({ itemIdentifier: p.messageId });
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      batchItemFailures: failures,
    });
  }
}
