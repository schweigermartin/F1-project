import { z } from "zod";

/**
 * Prediction contract for Phase 4 (Inference + Bedrock). Single source of
 * truth for three consumers (Constitution III/VI):
 *   - the Inference lambda writes `prediction#<N>` / `explanation#<N>` items,
 *   - the Read-API serializes a `PredictionApiResponse`,
 *   - the predictor frontend validates that response before rendering.
 *
 * Defense in depth like PipelineEventSchema / WS messages: the API validates
 * what it reads from DDB, the frontend re-validates what it gets over the wire.
 * Schema drift fails loudly instead of rendering a half-broken bar chart.
 *
 * `PREDICTION_API_SCHEMA_VERSION` lets the frontend reject a stale response
 * shape after a partial deploy instead of silently misreading it.
 */
export const PREDICTION_API_SCHEMA_VERSION = 1 as const;

/**
 * The twelve pre-race features, in the exact order the model expects them.
 * Mirrors `FEATURE_NAMES` in `ml/src/f1pred/schema.py` (cross-language, same
 * pattern as `layout.py` ↔ `s3-layout.ts`). If the model gains/loses a feature
 * the two lists diverge and SHAP rows fail this enum loudly — which is the
 * point: a silent feature mismatch would mean a silent mis-explanation.
 *
 * The trailing six are the 0.2.0 additions (Phase 006): richer quali signal +
 * practice pace.
 */
export const PODIUM_FEATURE_NAMES = [
  "grid_position",
  "quali_gap_to_pole_s",
  "driver_form",
  "constructor_form",
  "track_history",
  "is_wet",
  "quali_segment_reached",
  "quali_grid_delta",
  "quali_teammate_gap_s",
  "practice_best_pace_gap_s",
  "practice_long_run_pace_s",
  "practice_laps_count",
] as const;
export type PodiumFeatureName = (typeof PODIUM_FEATURE_NAMES)[number];
export const PodiumFeatureNameSchema = z.enum(PODIUM_FEATURE_NAMES);

/**
 * One SHAP contribution for a single (driver, feature) pair. `contribution`
 * is signed — positive pushes the driver toward the podium, negative away —
 * so it is a plain `number`, not bounded like the probability.
 */
export const ShapContributionSchema = z.object({
  feature: PodiumFeatureNameSchema,
  contribution: z.number(),
});
export type ShapContribution = z.infer<typeof ShapContributionSchema>;

/**
 * A single driver's podium prediction (DDB `prediction#<driverNumber>`).
 * The probability comes from the model only — never from the LLM (AC-5).
 */
export const PredictionItemSchema = z.object({
  driver_number: z.number().int().positive(),
  driver_code: z.string(), // 3-letter code, e.g. "VER"
  podium_probability: z.number().min(0).max(1),
  shap_top: z.array(ShapContributionSchema),
  model_version: z.string(), // SemVer of the artifact under models/<version>/
  predicted_at: z.string().datetime({ offset: true }),
});
export type PredictionItem = z.infer<typeof PredictionItemSchema>;

/**
 * The cached Bedrock explanation for a driver (DDB `explanation#<driverNumber>`).
 * Cached per (race, driver, model_version) so a second page load costs nothing
 * (AC-3). Absent until the first successful Bedrock call — the frontend shows
 * "Begründung folgt" in the meantime (plan §2 failure-mode).
 */
export const ExplanationItemSchema = z.object({
  bedrock_text: z.string(),
  model_id: z.string(), // e.g. "claude-haiku-4-5-20251001"
  cached_at: z.string().datetime({ offset: true }),
});
export type ExplanationItem = z.infer<typeof ExplanationItemSchema>;

/**
 * Per-driver view the Read-API returns: the prediction plus its explanation,
 * which is `null` while Bedrock hasn't (yet) produced one.
 */
export const PredictionWithExplanationSchema = PredictionItemSchema.extend({
  explanation: ExplanationItemSchema.nullable(),
});
export type PredictionWithExplanation = z.infer<typeof PredictionWithExplanationSchema>;

/**
 * Full Read-API payload for one race. `drivers` is returned unsorted; the
 * frontend sorts by `podium_probability` descending (US-1). `model_version`
 * is surfaced at the top level for the UI badge even though each driver row
 * also carries it (they must agree — all rows of a race share one model).
 */
export const PredictionApiResponseSchema = z.object({
  schema_version: z.literal(PREDICTION_API_SCHEMA_VERSION),
  race_date: z.string(), // ISO date, e.g. "2026-06-07"
  round: z.number().int().positive(),
  model_version: z.string(),
  drivers: z.array(PredictionWithExplanationSchema),
});
export type PredictionApiResponse = z.infer<typeof PredictionApiResponseSchema>;
