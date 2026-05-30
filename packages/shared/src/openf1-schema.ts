import { z } from "zod";

/**
 * Zod schemas for every OpenF1 endpoint we poll.
 *
 * Schemas are intentionally LENIENT about extra fields (OpenF1 occasionally
 * adds new ones) but STRICT about types we read. Live data has many `null`s
 * before a lap completes — handled explicitly per field. See
 * `docs/openf1-notes.md` for the spike that drove these shapes.
 *
 * Endpoint names match OpenF1 exactly — note `/position` is SINGULAR while
 * `/intervals`, `/laps`, `/stints`, `/weather` are plural.
 */

// ─── Branding for the endpoint enum ──────────────────────────────────────
export const OPENF1_DATA_ENDPOINTS = [
  "position",
  "intervals",
  "laps",
  "stints",
  "weather",
] as const;
export type OpenF1DataEndpoint = (typeof OPENF1_DATA_ENDPOINTS)[number];
export const OpenF1DataEndpointSchema = z.enum(OPENF1_DATA_ENDPOINTS);

// ─── /sessions ───────────────────────────────────────────────────────────
export const SessionSchema = z.object({
  session_key: z.number().int(),
  session_type: z.string(), // "Practice" | "Qualifying" | "Race" | "Sprint" | …
  session_name: z.string(),
  date_start: z.string().datetime({ offset: true }),
  date_end: z.string().datetime({ offset: true }),
  meeting_key: z.number().int(),
  circuit_key: z.number().int(),
  circuit_short_name: z.string(),
  country_key: z.number().int(),
  country_code: z.string(),
  country_name: z.string(),
  location: z.string(),
  gmt_offset: z.string(),
  year: z.number().int(),
  is_cancelled: z.boolean(),
});
export type Session = z.infer<typeof SessionSchema>;

// ─── /position (singular!) ───────────────────────────────────────────────
export const PositionSchema = z.object({
  date: z.string().datetime({ offset: true }),
  session_key: z.number().int(),
  meeting_key: z.number().int(),
  driver_number: z.number().int(),
  position: z.number().int(),
});
export type Position = z.infer<typeof PositionSchema>;

// ─── /intervals ──────────────────────────────────────────────────────────
// gap_to_leader is a number in seconds OR a lap-count string like "+1 LAP".
const NumberOrLapStringSchema = z.union([z.number(), z.string()]);

export const IntervalSchema = z.object({
  date: z.string().datetime({ offset: true }),
  session_key: z.number().int(),
  meeting_key: z.number().int(),
  driver_number: z.number().int(),
  gap_to_leader: NumberOrLapStringSchema.nullable(),
  interval: NumberOrLapStringSchema.nullable(),
});
export type Interval = z.infer<typeof IntervalSchema>;

// ─── /laps ───────────────────────────────────────────────────────────────
// Almost everything except identifiers can be null while the lap is running.
export const LapSchema = z.object({
  meeting_key: z.number().int(),
  session_key: z.number().int(),
  driver_number: z.number().int(),
  lap_number: z.number().int(),
  date_start: z.string().datetime({ offset: true }).nullable(),
  duration_sector_1: z.number().nullable(),
  duration_sector_2: z.number().nullable(),
  duration_sector_3: z.number().nullable(),
  i1_speed: z.number().nullable(),
  i2_speed: z.number().nullable(),
  st_speed: z.number().nullable().optional(), // not always present
  is_pit_out_lap: z.boolean(),
  lap_duration: z.number().nullable(),
  segments_sector_1: z.array(z.number().int()).nullable().optional(),
  segments_sector_2: z.array(z.number().int()).nullable().optional(),
  segments_sector_3: z.array(z.number().int()).nullable().optional(),
});
export type Lap = z.infer<typeof LapSchema>;

// ─── /stints ─────────────────────────────────────────────────────────────
export const TyreCompoundSchema = z.enum([
  "SOFT",
  "MEDIUM",
  "HARD",
  "INTERMEDIATE",
  "WET",
  "UNKNOWN",
]);
export type TyreCompound = z.infer<typeof TyreCompoundSchema>;

export const StintSchema = z.object({
  meeting_key: z.number().int(),
  session_key: z.number().int(),
  stint_number: z.number().int(),
  driver_number: z.number().int(),
  lap_start: z.number().int(),
  lap_end: z.number().int(),
  compound: TyreCompoundSchema,
  tyre_age_at_start: z.number().int(),
});
export type Stint = z.infer<typeof StintSchema>;

// ─── /weather ────────────────────────────────────────────────────────────
export const WeatherSchema = z.object({
  date: z.string().datetime({ offset: true }),
  session_key: z.number().int(),
  meeting_key: z.number().int(),
  pressure: z.number(),
  humidity: z.number(),
  wind_direction: z.number(),
  air_temperature: z.number(),
  track_temperature: z.number(),
  wind_speed: z.number(),
  rainfall: z.number(), // 0 = dry, otherwise intensity indicator
});
export type Weather = z.infer<typeof WeatherSchema>;

// ─── Per-endpoint payload schema lookup ──────────────────────────────────
// Each endpoint returns an array of its row type. The consumer uses this to
// pick the right schema based on the message's endpoint field.
export const ENDPOINT_PAYLOAD_SCHEMAS = {
  position: z.array(PositionSchema),
  intervals: z.array(IntervalSchema),
  laps: z.array(LapSchema),
  stints: z.array(StintSchema),
  weather: z.array(WeatherSchema),
} as const satisfies Record<OpenF1DataEndpoint, z.ZodTypeAny>;

/**
 * Check whether a session is currently active. Defined here (not in the
 * lambda) so the dashboard, scheduler, and tests all share one definition.
 */
export function isSessionActive(session: Session, now: Date = new Date()): boolean {
  if (session.is_cancelled) return false;
  const start = new Date(session.date_start);
  const end = new Date(session.date_end);
  return now >= start && now <= end;
}
