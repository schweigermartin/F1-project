import { z } from "zod";

/**
 * Evaluation contract for Phase 5 (Feedback Loop). Single source of truth for
 * three consumers (Constitution III/VI):
 *   - the Evaluation lambda writes one `RaceEvaluation` per race (twice: under
 *     the race PK and the season PK, see ddb-keys),
 *   - the Read-API serializes a `SeasonEvaluationResponse`,
 *   - the predictor frontend validates that response before charting it.
 *
 * Same defense-in-depth as the prediction schema: every hop re-validates, so
 * a drifted DDB row fails loudly instead of plotting a wrong season chart.
 */
export const SEASON_API_SCHEMA_VERSION = 1 as const;

/**
 * Event-bus contract between the Archiver (Phase 1) and the Evaluation lambda:
 * the Archiver puts one custom EventBridge event per consolidated session
 * (spec D-2 — deliberately not S3 notifications, which also fire per part).
 */
export const ARCHIVER_EVENT_SOURCE = "f1.archiver" as const;
export const SESSION_ARCHIVED_DETAIL_TYPE = "SessionArchived" as const;

/** Detail payload of the SessionArchived event — both sides import this. */
export const SessionArchivedDetailSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  session_id: z.string().min(1), // OpenF1 session_key, stringified (PipelineEvent convention)
});
export type SessionArchivedDetail = z.infer<typeof SessionArchivedDetailSchema>;

/** One of the model's three highest-probability drivers for a race. */
export const PredictedPodiumDriverSchema = z.object({
  driver_number: z.number().int().positive(),
  driver_code: z.string(),
  podium_probability: z.number().min(0).max(1),
});
export type PredictedPodiumDriver = z.infer<typeof PredictedPodiumDriverSchema>;

/**
 * One actual podium finisher, from the last archived `position` tick.
 * `driver_code` is mapped from the race's prediction rows and is `null` when
 * a podium driver wasn't among the predicted grid (position rows carry only
 * the driver number).
 */
export const ActualPodiumDriverSchema = z.object({
  driver_number: z.number().int().positive(),
  driver_code: z.string().nullable(),
  position: z.number().int().min(1).max(3),
});
export type ActualPodiumDriver = z.infer<typeof ActualPodiumDriverSchema>;

/**
 * The persisted outcome of evaluating one race's predictions against the
 * archived result (spec AC-2). Metric definitions (spec "Metriken"):
 *   - top3_hit_rate: |predicted top-3 ∩ actual top-3| / 3
 *   - brier_score: mean over predicted drivers of (p − y)², y = actually on podium
 */
export const RaceEvaluationSchema = z.object({
  race_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  round: z.number().int().positive(),
  season: z.number().int(),
  model_version: z.string(),
  n_drivers: z.number().int().positive(),
  top3_hit_rate: z.number().min(0).max(1),
  brier_score: z.number().min(0).max(1),
  predicted_top3: z.array(PredictedPodiumDriverSchema).length(3),
  actual_top3: z.array(ActualPodiumDriverSchema).length(3),
  evaluated_at: z.string().datetime({ offset: true }),
});
export type RaceEvaluation = z.infer<typeof RaceEvaluationSchema>;

/**
 * Read-API payload for `?season=<year>`: every evaluated race of the season,
 * sorted by round ascending. An empty `races` array is a normal state ("no
 * race evaluated yet"), not an error — the frontend renders an empty state.
 */
export const SeasonEvaluationResponseSchema = z.object({
  schema_version: z.literal(SEASON_API_SCHEMA_VERSION),
  season: z.number().int(),
  races: z.array(RaceEvaluationSchema),
});
export type SeasonEvaluationResponse = z.infer<typeof SeasonEvaluationResponseSchema>;
