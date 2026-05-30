import { z } from "zod";

import { OpenF1DataEndpointSchema } from "./openf1-schema.js";

/**
 * Schema for messages flowing through SQS between Poller and Consumer.
 *
 * Payload is intentionally `z.unknown()` here — the Consumer dispatches on
 * `endpoint` and runs the matching per-endpoint schema from
 * ENDPOINT_PAYLOAD_SCHEMAS. Defense in depth: Poller validates on the way
 * in, Consumer validates again on the way out (Constitution VI).
 *
 * `schema_version` lets the Consumer reject messages from an older Poller
 * during partial deploys instead of silently misinterpreting them.
 */
export const PIPELINE_EVENT_SCHEMA_VERSION = 1 as const;

export const PipelineEventSchema = z.object({
  session_id: z.string(), // OpenF1 session_key, stringified for stable PK use
  endpoint: OpenF1DataEndpointSchema,
  payload: z.unknown(),
  fetched_at: z.string().datetime({ offset: true }),
  schema_version: z.literal(PIPELINE_EVENT_SCHEMA_VERSION),
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;
