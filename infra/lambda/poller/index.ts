import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { ScheduledEvent } from "aws-lambda";

import { type PollerEvent, pollOnce } from "./handler.js";

const QUEUE_URL = process.env["EVENTS_QUEUE_URL"];
if (!QUEUE_URL) throw new Error("EVENTS_QUEUE_URL env var not set");

const sqs = new SQSClient({});

// Lambda entrypoint. EventBridge Scheduler delivers either a ScheduledEvent
// shell with our `{ session_key }` as the Input payload, or — when invoked
// manually — a bare PollerEvent. Accept both shapes.
export async function handler(
  event: ScheduledEvent | PollerEvent,
): Promise<{ ok: boolean; summary: unknown }> {
  const sessionKey = "session_key" in event ? event.session_key : undefined;
  if (typeof sessionKey !== "number") {
    throw new Error(`Poller invoked without session_key. Event: ${JSON.stringify(event)}`);
  }

  const metrics: Array<{ name: string; value: number; dim?: Record<string, string> }> = [];

  const summary = await pollOnce(
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
  );

  // Single JSON line per invocation — picked up by CloudWatch Logs Insights
  // and parsed by the alarms we add in T13.
  console.log(JSON.stringify({ level: "info", msg: "poller.tick", summary, metrics }));
  return { ok: summary.http_failures === 0 && summary.schema_failures === 0, summary };
}
