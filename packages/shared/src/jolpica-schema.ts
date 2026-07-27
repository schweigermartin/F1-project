import { z } from "zod";

/**
 * Zod schemas for the Jolpica/Ergast lap-by-lap endpoints (Phase 9, plan §4).
 *
 * Jolpica is the free Ergast-compatible successor — no key, no CORS header, so
 * these are only ever fetched server-side. The API serialises EVERY number as a
 * string (`"total": "1429"`, `"position": "3"`); the schemas convert them once,
 * here, so no consumer has to remember to `Number()` anything (Constitution III).
 * A value that is not digits-only fails the parse loudly instead of silently
 * becoming `NaN` (Constitution VI).
 *
 * Pagination matters: one race has ~1400 lap records and the Ergast default
 * limit is 30, so the envelope fields `limit`/`offset`/`total` are part of the
 * contract — see {@link nextJolpicaOffset} (spec R-2).
 */

/** `"1429"` → `1429`. Rejects `""`, `"-1"`, `"1.5"`, `null` — drift is loud. */
const NumericString = z.string().regex(/^\d+$/, "expected a digits-only string").transform(Number);

/** The three envelope fields every paginated Ergast response carries. */
export const JolpicaPaginationSchema = z.object({
  limit: NumericString,
  offset: NumericString,
  total: NumericString,
});
export type JolpicaPagination = z.infer<typeof JolpicaPaginationSchema>;

/** Race identity, repeated inside every page of a paginated response. */
const JolpicaRaceMetaSchema = z.object({
  season: NumericString,
  round: NumericString,
  raceName: z.string().min(1),
  date: z.string().min(1),
});

// ─── /laps ───────────────────────────────────────────────────────────────
// One `Laps[]` entry per lap number, one `Timings[]` entry per driver on it.
// A page boundary can split a single lap across two responses, so consumers
// must flatten rather than assume a lap arrives whole.

export const JolpicaLapTimingSchema = z.object({
  driverId: z.string().min(1),
  position: NumericString,
  /** `"1:29.421"` — minutes:seconds.millis, never pre-parsed by the API. */
  time: z.string().min(1),
});
export type JolpicaLapTiming = z.infer<typeof JolpicaLapTimingSchema>;

export const JolpicaLapSchema = z.object({
  number: NumericString,
  Timings: z.array(JolpicaLapTimingSchema),
});
export type JolpicaLap = z.infer<typeof JolpicaLapSchema>;

export const JolpicaLapsSchema = z.object({
  MRData: JolpicaPaginationSchema.extend({
    RaceTable: z.object({
      Races: z.array(JolpicaRaceMetaSchema.extend({ Laps: z.array(JolpicaLapSchema) })),
    }),
  }),
});
export type JolpicaLapsResponse = z.infer<typeof JolpicaLapsSchema>;

// ─── /pitstops ───────────────────────────────────────────────────────────

export const JolpicaPitStopSchema = z.object({
  driverId: z.string().min(1),
  /** The lap the car came in on — the stint before it ends here. */
  lap: NumericString,
  /** 1-based stop counter per driver. */
  stop: NumericString,
  /** Local wall-clock time of the stop, e.g. `"15:15:19"`. */
  time: z.string().min(1),
  /** Stationary + pit-lane duration in seconds, e.g. `"21.789"`. */
  duration: z.string().min(1),
});
export type JolpicaPitStop = z.infer<typeof JolpicaPitStopSchema>;

export const JolpicaPitStopsSchema = z.object({
  MRData: JolpicaPaginationSchema.extend({
    RaceTable: z.object({
      Races: z.array(JolpicaRaceMetaSchema.extend({ PitStops: z.array(JolpicaPitStopSchema) })),
    }),
  }),
});
export type JolpicaPitStopsResponse = z.infer<typeof JolpicaPitStopsSchema>;

/**
 * Offset of the next page, or `null` when `total` is covered. Pure so the
 * paging loop is unit-testable and can never spin forever: a non-positive
 * `limit` (drift, or a server that ignored our request) terminates it.
 */
export function nextJolpicaOffset(pagination: JolpicaPagination): number | null {
  if (pagination.limit <= 0) return null;
  const next = pagination.offset + pagination.limit;
  return next < pagination.total ? next : null;
}
