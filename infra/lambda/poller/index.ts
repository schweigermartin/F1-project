import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { Context, ScheduledEvent } from "aws-lambda";

import { ingestSession, type PollerEvent } from "./handler.js";

const QUEUE_URL = process.env["EVENTS_QUEUE_URL"];
if (!QUEUE_URL) throw new Error("EVENTS_QUEUE_URL env var not set");

const sqs = new SQSClient({});

/** Safety buffer kept for the Lambda runtime to shut down cleanly. */
const LAMBDA_SHUTDOWN_BUFFER_MS = 5_000;

// Lambda entrypoint. EventBridge Scheduler delivers either a ScheduledEvent
// shell with our `{ session_key }` as the Input payload, or — when invoked
// manually (the backfill path) — a bare PollerEvent. Accept both shapes.
export async function handler(
  event: ScheduledEvent | PollerEvent,
  context: Context,
): Promise<{ ok: boolean; summary: unknown }> {
  const sessionKey = "session_key" in event ? event.session_key : undefined;
  if (typeof sessionKey !== "number") {
    throw new Error(`Ingest invoked without session_key. Event: ${JSON.stringify(event)}`);
  }

  const metrics: Array<{ name: string; value: number; dim?: Record<string, string> }> = [];

  // One pass over every endpoint. The deadline still guards the λ timeout —
  // a full-session payload is much larger than a 5s snapshot, so a slow
  // endpoint can still eat the clock even without the old tick loop.
  const remainingMs = context.getRemainingTimeInMillis();
  const deadlineMs = Date.now() + (remainingMs - LAMBDA_SHUTDOWN_BUFFER_MS);

  const summary = await ingestSession(
    { session_key: sessionKey },
    {
      fetch: globalThis.fetch.bind(globalThis),
      sendMessage: async (body) => {
        await sqs.send(new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: body }));
      },
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      emitMetric: (name, value, dim) => metrics.push({ name, value, dim }),
    },
    deadlineMs,
  );

  console.log(JSON.stringify({ level: "info", msg: "ingest.run", summary, metrics }));

  // The session hasn't gone free yet (an overrunning session pushes `date_end`
  // back, so end+35min was still inside OpenF1's paid window). Throw so the
  // delivery lands in the scheduler DLQ and trips its alarm — the same
  // mechanism that finally surfaced the round-8..11 prediction misses. A
  // redrive re-runs the ingest, by which time the data is free. Deliberately
  // reusing the DLQ instead of self-rescheduling: no extra IAM surface, and an
  // operator sees it rather than it retrying invisibly.
  if (summary.still_live) {
    throw new Error(
      `Session ${sessionKey} still in OpenF1's paid live window (${summary.unauthorized} endpoints returned 401) — redrive this message once the session has gone historical.`,
    );
  }

  return { ok: summary.http_failures === 0 && summary.schema_failures === 0, summary };
}
