import {
  evalSK,
  EVALUATION_SK,
  PipelineEventSchema,
  type Position,
  PositionSchema,
  type PredictionItem,
  PredictionItemSchema,
  type RaceEvaluation,
  RaceEvaluationSchema,
  racePK,
  S3_PATHS,
  seasonPK,
  type Session,
  SessionArchivedDetailSchema,
  SessionSchema,
} from "@f1/shared";
import { z } from "zod";

/**
 * Evaluation logic (Phase 5) — closes the feedback loop. Fired once per
 * archived session (Archiver's SessionArchived event); for race sessions with
 * predictions it scores the model against the archived result and persists
 * the outcome back into F1Predictions.
 *
 * The actual podium comes from our own archive (spec D-1): the last `position`
 * tick per driver in `raw/sessions/<date>/<session_id>.jsonl`. Validation is
 * loud at every boundary (Constitution VI): event detail, OpenF1 sessions,
 * archive lines, prediction rows, and the evaluation payload itself.
 */

/** Predictions exist for every race we care about; fewer means the archive is
 * unusable for scoring (R-3) — failing loudly beats writing a wrong hit-rate. */
const PODIUM_SIZE = 3;

export interface EvaluationDeps {
  /** OpenF1 `/sessions?session_key=` — resolves the archived session's metadata. */
  fetchSessionByKey: (sessionKey: string) => Promise<unknown>;
  /** OpenF1 `/sessions?year=&session_name=Race` — the season's races, for the round. */
  fetchSeasonRaces: (year: number) => Promise<unknown>;
  /** Raw text of the consolidated archive JSONL. */
  getArchiveText: (key: string) => Promise<string>;
  /** Query every item under one race PK; returns DDB-unmarshalled records. */
  queryRace: (pk: string) => Promise<Record<string, unknown>[]>;
  /** Persist one DDB item (PutItem, overwrite semantics — idempotent re-runs). */
  putItem: (item: Record<string, unknown>) => Promise<void>;
  now: () => Date;
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export type EvaluationResult =
  | { skipped: "not-race"; session_name: string }
  | { skipped: "no-predictions"; race_date: string; round: number }
  | { evaluation: RaceEvaluation };

/** Archive holds too little position data to derive a podium (R-3). */
export class IncompleteArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteArchiveError";
  }
}

/** The archived session_key doesn't resolve via OpenF1 — schema drift or a
 * vanished session; either way scoring is impossible and must page. */
export class SessionResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionResolutionError";
  }
}

const PREDICTION_SK_PREFIX = "prediction#";

/**
 * Championship round = this race's 1-based position among the season's
 * NON-CANCELLED races, sorted by start date — the exact logic schedule-sync
 * uses to stamp the inference event (D-3), so the PK here matches the one the
 * predictions were written under. Cancelled races must not count: the official
 * numbering (Jolpica, which the frontend queries by) skips them — verified
 * against the 2026 season, where two cancelled spring races would otherwise
 * shift every later round by two.
 */
export function raceRound(session: Session, seasonRaces: Session[]): number {
  const sorted = seasonRaces
    .filter((r) => !r.is_cancelled)
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
  return sorted.findIndex((r) => r.session_key === session.session_key) + 1;
}

/**
 * Fold the archived JSONL into the final position per driver: for each driver
 * keep the `position` row with the latest own `date` (not `fetched_at` — a
 * poll batch can contain rows in any order). Unparseable lines are skipped
 * (they were already tolerated by the Archiver); a `position` payload that
 * fails its schema fails loudly (Constitution VI — that's drift, not noise).
 */
export function finalPositions(archiveText: string): Map<number, Position> {
  const latest = new Map<number, Position>();
  for (const raw of archiveText.split("\n")) {
    if (!raw) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(raw);
    } catch {
      continue;
    }
    const env = PipelineEventSchema.safeParse(parsedLine);
    if (!env.success || env.data.endpoint !== "position") continue;
    const rows = z.array(PositionSchema).parse(env.data.payload);
    for (const row of rows) {
      const prev = latest.get(row.driver_number);
      if (!prev || row.date >= prev.date) latest.set(row.driver_number, row);
    }
  }
  return latest;
}

/** The three highest-probability drivers; ties broken by driver number
 * ascending so re-runs are deterministic. */
export function predictedTop3(predictions: PredictionItem[]): PredictionItem[] {
  return [...predictions]
    .sort(
      (a, b) => b.podium_probability - a.podium_probability || a.driver_number - b.driver_number,
    )
    .slice(0, PODIUM_SIZE);
}

export interface RaceMetrics {
  top3_hit_rate: number;
  brier_score: number;
}

/**
 * Spec "Metriken": hit rate = |predicted ∩ actual| / 3; Brier = mean over the
 * *predicted* drivers of (p − y)², y = driver actually finished on the podium.
 */
export function computeMetrics(
  predictions: PredictionItem[],
  actualPodiumNumbers: Set<number>,
): RaceMetrics {
  const top3 = predictedTop3(predictions);
  const hits = top3.filter((p) => actualPodiumNumbers.has(p.driver_number)).length;
  const brierSum = predictions.reduce((sum, p) => {
    const y = actualPodiumNumbers.has(p.driver_number) ? 1 : 0;
    return sum + (p.podium_probability - y) ** 2;
  }, 0);
  return {
    top3_hit_rate: hits / PODIUM_SIZE,
    brier_score: brierSum / predictions.length,
  };
}

export async function evaluateArchivedSession(
  rawDetail: unknown,
  deps: EvaluationDeps,
): Promise<EvaluationResult> {
  const detail = SessionArchivedDetailSchema.parse(rawDetail);

  // 1. Is this archived session a race? (Sprints/practice/quali: clean skip.)
  const sessionRaw = await deps.fetchSessionByKey(detail.session_id);
  const sessions = z.array(SessionSchema).parse(sessionRaw);
  const session = sessions.find((s) => String(s.session_key) === detail.session_id);
  if (!session) {
    throw new SessionResolutionError(`session_key ${detail.session_id} not found via OpenF1`);
  }
  if (session.session_name !== "Race") {
    deps.emitMetric("EvaluationSkippedNotRace", 1);
    return { skipped: "not-race", session_name: session.session_name };
  }

  // 2. Round — must match the PK the inference λ wrote under (D-3).
  const seasonRaw = await deps.fetchSeasonRaces(session.year);
  const seasonRaces = z
    .array(SessionSchema)
    .parse(seasonRaw)
    .filter((s) => s.session_name === "Race");
  const round = raceRound(session, seasonRaces);
  if (round < 1) {
    throw new SessionResolutionError(
      `race ${detail.session_id} missing from season ${session.year} race list`,
    );
  }

  // 3. The race's predictions (R-4: none → skip with a metric, not an error).
  const items = await deps.queryRace(racePK(detail.date, round));
  const predictions = items
    .filter((i) => typeof i["SK"] === "string" && i["SK"].startsWith(PREDICTION_SK_PREFIX))
    .map((i) => PredictionItemSchema.parse(i));
  if (predictions.length === 0) {
    deps.emitMetric("EvaluationSkippedNoPredictions", 1);
    return { skipped: "no-predictions", race_date: detail.date, round };
  }

  // 4. Actual podium from the archive (D-1), guarded against thin data (R-3).
  const positions = finalPositions(
    await deps.getArchiveText(S3_PATHS.rawSession(detail.date, detail.session_id)),
  );
  if (positions.size < PODIUM_SIZE) {
    throw new IncompleteArchiveError(
      `archive for ${detail.session_id} has position data for only ${positions.size} drivers`,
    );
  }
  const codeByNumber = new Map(predictions.map((p) => [p.driver_number, p.driver_code]));
  const actualTop3 = [...positions.values()]
    .filter((p) => p.position >= 1 && p.position <= PODIUM_SIZE)
    .sort((a, b) => a.position - b.position)
    .map((p) => ({
      driver_number: p.driver_number,
      driver_code: codeByNumber.get(p.driver_number) ?? null,
      position: p.position,
    }));
  if (actualTop3.length !== PODIUM_SIZE) {
    throw new IncompleteArchiveError(
      `archive for ${detail.session_id} yields ${actualTop3.length} podium positions, expected ${PODIUM_SIZE}`,
    );
  }

  // 5. Score + persist (twice, same payload — race detail + season chart, D-4).
  const metrics = computeMetrics(predictions, new Set(actualTop3.map((p) => p.driver_number)));
  const evaluation = RaceEvaluationSchema.parse({
    race_date: detail.date,
    round,
    season: session.year,
    model_version: predictions[0]!.model_version,
    n_drivers: predictions.length,
    ...metrics,
    predicted_top3: predictedTop3(predictions).map((p) => ({
      driver_number: p.driver_number,
      driver_code: p.driver_code,
      podium_probability: p.podium_probability,
    })),
    actual_top3: actualTop3,
    evaluated_at: deps.now().toISOString(),
  } satisfies RaceEvaluation);

  await deps.putItem({ PK: racePK(detail.date, round), SK: EVALUATION_SK, ...evaluation });
  await deps.putItem({ PK: seasonPK(session.year), SK: evalSK(round), ...evaluation });

  deps.emitMetric("EvaluationRuns", 1);
  deps.emitMetric("EvaluationHitRate", evaluation.top3_hit_rate);
  deps.emitMetric("EvaluationBrier", evaluation.brier_score);
  return { evaluation };
}
