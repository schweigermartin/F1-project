import { z } from "zod";

import { TyreCompoundSchema, WeatherSchema } from "./openf1-schema.js";

/**
 * WebSocket message contract between the dashboard frontend and the
 * RealtimeStack lambdas (Phase 2). Single source of truth — both the
 * browser and the AWS lambdas import these (Constitution III/VI).
 *
 * Defense in depth (like PipelineEventSchema): the backend validates every
 * inbound ClientMessage, the frontend validates every inbound ServerMessage.
 * Anything that fails is dropped + logged, never silently processed (AC-6).
 *
 * Live and Replay deliberately share ServerMessage shapes so the frontend
 * renders both paths identically — the only difference is the source lambda.
 */

export const WS_MESSAGE_SCHEMA_VERSION = 1 as const;

/** OpenF1 gap/interval is a number (seconds) OR a lap string like "+1 LAP". */
const GapValueSchema = z.union([z.number(), z.string()]).nullable();

/** Replay playback speeds offered by the UI (AC-2). */
export const ReplaySpeedSchema = z.union([z.literal(1), z.literal(2), z.literal(4)]);
export type ReplaySpeed = z.infer<typeof ReplaySpeedSchema>;

// ─── DriverState — normalized per-driver view model ──────────────────────
// Aggregates the per-driver F1Live items (position / interval / stint / lap).
// Every field except the driver number can be null: live data is partial
// before a lap completes, and a freshly-subscribed snapshot may lack rows.
export const DriverStateSchema = z.object({
  driver_number: z.number().int(),
  position: z.number().int().nullable(),
  gap_to_leader: GapValueSchema,
  interval: GapValueSchema,
  compound: TyreCompoundSchema.nullable(),
  stint_number: z.number().int().nullable(),
  tyre_age: z.number().int().nullable(),
  last_lap_number: z.number().int().nullable(),
  last_lap_duration: z.number().nullable(),
});
export type DriverState = z.infer<typeof DriverStateSchema>;

/** Entity kinds a `delta` can carry — mirrors the F1Live SK entity naming. */
export const DELTA_ENTITIES = ["position", "interval", "lap", "stint", "weather"] as const;
export type DeltaEntity = (typeof DELTA_ENTITIES)[number];
export const DeltaEntitySchema = z.enum(DELTA_ENTITIES);

// ─── Client → Server ─────────────────────────────────────────────────────
export const SubscribeMessageSchema = z.object({
  action: z.literal("subscribe"),
  // Omitted → backend resolves the currently active session from F1Live.
  session_id: z.string().optional(),
});

export const ReplayStartMessageSchema = z.object({
  action: z.literal("replay:start"),
  session_id: z.string(),
  speed: ReplaySpeedSchema,
});

export const ReplayStopMessageSchema = z.object({
  action: z.literal("replay:stop"),
});

export const ClientMessageSchema = z.discriminatedUnion("action", [
  SubscribeMessageSchema,
  ReplayStartMessageSchema,
  ReplayStopMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Server → Client ─────────────────────────────────────────────────────
/**
 * `data` is intentionally `z.unknown()` — the frontend reducer narrows it by
 * `entity`. Same trade-off as PipelineEventSchema.payload: keep the envelope
 * cheap, validate the body at the point of use.
 */
export const DeltaMessageSchema = z.object({
  type: z.literal("delta"),
  session_id: z.string(),
  entity: DeltaEntitySchema,
  data: z.unknown(),
});

export const SnapshotMessageSchema = z.object({
  type: z.literal("snapshot"),
  session_id: z.string(),
  drivers: z.array(DriverStateSchema),
  weather: WeatherSchema.nullable(),
  // Present only when a large snapshot is split across frames (R-1, 128 KB cap).
  part: z.object({ n: z.number().int().positive(), of: z.number().int().positive() }).optional(),
});

export const ReplayEndMessageSchema = z.object({
  type: z.literal("replay:end"),
  session_id: z.string(),
});

export const InfoMessageSchema = z.object({
  type: z.literal("info"),
  code: z.enum(["no-live-session", "session-not-archived"]),
});

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  SnapshotMessageSchema,
  DeltaMessageSchema,
  ReplayEndMessageSchema,
  InfoMessageSchema,
  ErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
