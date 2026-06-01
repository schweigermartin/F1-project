import {
  ExplanationItemSchema,
  PREDICTION_API_SCHEMA_VERSION,
  type PredictionApiResponse,
  PredictionApiResponseSchema,
  type PredictionItem,
  PredictionItemSchema,
  racePK,
} from "@f1/shared";
import { z } from "zod";

/**
 * Predictions Read-API — the only path the predictor frontend uses to reach
 * the F1Predictions table (no direct DDB/Bedrock from the browser, plan §
 * security). Pure DI: index.ts wires the DocumentClient Query; the merge +
 * validation logic is unit-tested without any AWS SDK.
 *
 * One race = one DDB partition (`race#<date>#<round>`), holding interleaved
 * `prediction#<NN>` and `explanation#<NN>` rows. We fetch the whole partition
 * with a single Query, then stitch each driver's optional explanation onto its
 * prediction. The response is re-validated against the shared schema before it
 * leaves the lambda (defense in depth, Constitution VI) so a drifted DDB row
 * fails loudly here instead of half-rendering a chart in the browser.
 */

/** Query string the Function URL receives (`?race_date=YYYY-MM-DD&round=7`). */
const RaceQuerySchema = z.object({
  race_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "race_date must be YYYY-MM-DD"),
  round: z.coerce.number().int().positive(),
});
export type RaceQuery = z.infer<typeof RaceQuerySchema>;

export interface ReadApiDeps {
  /** Query every item under one race PK; returns DDB-unmarshalled records. */
  queryRace: (pk: string) => Promise<Record<string, unknown>[]>;
  emitMetric?: (name: string, value: number) => void;
}

/** Bad/missing query params → the adapter maps this to HTTP 400. */
export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQueryError";
  }
}

/** No predictions for this race yet → the adapter maps this to HTTP 404. */
export class RaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RaceNotFoundError";
  }
}

const EXPLANATION_SK_PREFIX = "explanation#";
const PREDICTION_SK_PREFIX = "prediction#";

export async function getRacePredictions(
  rawQuery: Record<string, string | undefined> | null,
  deps: ReadApiDeps,
): Promise<PredictionApiResponse> {
  const parsed = RaceQuerySchema.safeParse(rawQuery ?? {});
  if (!parsed.success) {
    throw new InvalidQueryError(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { race_date, round } = parsed.data;

  const items = await deps.queryRace(racePK(race_date, round));

  // Predictions key on their own `driver_number` field; explanations carry the
  // driver only in the SK (`explanation#<NN>`), so parse it back from there.
  const predictions = new Map<number, PredictionItem>();
  const explanations = new Map<number, z.infer<typeof ExplanationItemSchema>>();
  for (const raw of items) {
    const sk = typeof raw["SK"] === "string" ? raw["SK"] : "";
    if (sk.startsWith(PREDICTION_SK_PREFIX)) {
      const p = PredictionItemSchema.parse(raw);
      predictions.set(p.driver_number, p);
    } else if (sk.startsWith(EXPLANATION_SK_PREFIX)) {
      const driverNumber = Number.parseInt(sk.slice(EXPLANATION_SK_PREFIX.length), 10);
      explanations.set(driverNumber, ExplanationItemSchema.parse(raw));
    }
  }

  if (predictions.size === 0) {
    throw new RaceNotFoundError(`no predictions for ${race_date} round ${round}`);
  }

  // Returned unsorted — the frontend sorts by probability (US-1).
  const drivers = [...predictions.values()].map((p) => ({
    ...p,
    explanation: explanations.get(p.driver_number) ?? null,
  }));

  // All rows of one race share a model; surface it once for the UI badge.
  const model_version = drivers[0]!.model_version;

  deps.emitMetric?.("PredictionsServed", drivers.length);

  return PredictionApiResponseSchema.parse({
    schema_version: PREDICTION_API_SCHEMA_VERSION,
    race_date,
    round,
    model_version,
    drivers,
  } satisfies PredictionApiResponse);
}
