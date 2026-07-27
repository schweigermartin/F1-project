import { isSessionActive, type Session, SessionSchema } from "@f1/shared";

/**
 * Schedule-Sync — runs daily, programmes one EventBridge Schedule per
 * upcoming F1 session. Each schedule fires the Ingest λ exactly once, 35
 * minutes after the session ends.
 *
 * Why *after* the session and not during it (Phase 9, D-1)? OpenF1 classifies
 * data as "live" from 30min before a session starts until 30min after it ends
 * and gates that window behind a paid tier. The previous design polled at 5s
 * inside exactly that window with no credentials and got HTTP 401 on every
 * single request — 15,289 of them during the 2026-07-26 race, zero successes,
 * and consequently not one race archived all season. Outside the window the
 * same data is free, final, and complete, so one pass replaces ~700 ticks.
 *
 * Idempotent — names schedules deterministically (`f1-ingest-<session_key>`),
 * upserts via Create-or-Update.
 */

const HORIZON_HOURS = 48;
/** Session data turns free 30min after `date_end`; +5min of headroom (R-1). */
const INGEST_DELAY_MINUTES = 35;
/** Inference runs once, T-60min before a race start (Phase 4 AC-1 / D5). */
const INFERENCE_LEAD_MINUTES = 60;

/** A one-shot schedule firing the Ingest λ once, after the session went free. */
export interface IngestScheduleSpec {
  name: string;
  session_key: number;
  runAt: Date;
}

/**
 * A one-shot schedule that fires the Phase-4 Inference λ once, T-60min before a
 * race. `round` is the championship ordinal among the season's races (OpenF1
 * sessions carry no round number), matching the FastF1 round used in training.
 */
export interface InferenceScheduleSpec {
  name: string;
  session_key: number;
  race_date: string; // YYYY-MM-DD
  round: number;
  model_version: string;
  runAt: Date;
}

export interface ScheduleSyncDeps {
  fetchSessions: () => Promise<unknown>;
  /** Existing schedule names across all three prefixes (incl. legacy f1-poll-*). */
  listExistingSchedules: () => Promise<string[]>;
  upsertIngestSchedule: (spec: IngestScheduleSpec) => Promise<void>;
  upsertInferenceSchedule: (spec: InferenceScheduleSpec) => Promise<void>;
  deleteSchedule: (name: string) => Promise<void>;
  /** Active model version stamped into each inference schedule's input. */
  modelVersion: string;
  now: () => Date;
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export interface ScheduleSyncResult {
  upserted: IngestScheduleSpec[];
  deleted: string[];
  skipped: number;
  inferenceUpserted: InferenceScheduleSpec[];
  inferenceDeleted: string[];
}

export const INGEST_SCHEDULE_PREFIX = "f1-ingest-";
export const INFERENCE_SCHEDULE_PREFIX = "f1-infer-";
/**
 * Pre-Phase-9 recurring poll schedules. Nothing creates these any more; the
 * sweep deletes any it still finds so the changeover cleans up after itself.
 * Removable once a full season has passed without one showing up.
 */
export const LEGACY_POLL_PREFIX = "f1-poll-";

function scheduleNameFor(session_key: number): string {
  return `${INGEST_SCHEDULE_PREFIX}${session_key}`;
}

function isRace(session: Session): boolean {
  return session.session_name === "Race";
}

/**
 * Championship round = this race's 1-based position among the season's
 * NON-CANCELLED races. Cancelled races must not count: the official numbering
 * (Jolpica, which the predictor frontend queries by) skips them, and the
 * Phase-5 evaluation λ derives the same round to find these predictions again
 * — counting a cancelled race would shift every later round and orphan both.
 */
function raceRound(session: Session, allValidated: Session[]): number {
  const races = allValidated
    .filter((s) => isRace(s) && !s.is_cancelled)
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
  return races.findIndex((r) => r.session_key === session.session_key) + 1;
}

function toInferenceSpec(
  session: Session,
  round: number,
  modelVersion: string,
): InferenceScheduleSpec {
  const start = new Date(session.date_start);
  return {
    name: `${INFERENCE_SCHEDULE_PREFIX}${session.session_key}`,
    session_key: session.session_key,
    race_date: session.date_start.slice(0, 10),
    round,
    model_version: modelVersion,
    runAt: new Date(start.getTime() - INFERENCE_LEAD_MINUTES * 60 * 1000),
  };
}

function pickUpcomingSessions(sessions: Session[], now: Date): Session[] {
  const horizon = new Date(now.getTime() + HORIZON_HOURS * 60 * 60 * 1000);
  return sessions.filter((s) => {
    if (s.is_cancelled) return false;
    const start = new Date(s.date_start);
    const end = new Date(s.date_end);
    // Include sessions that are currently running OR will start within the horizon.
    return end > now && start < horizon;
  });
}

function toIngestSpec(session: Session): IngestScheduleSpec {
  const end = new Date(session.date_end);
  return {
    name: scheduleNameFor(session.session_key),
    session_key: session.session_key,
    runAt: new Date(end.getTime() + INGEST_DELAY_MINUTES * 60 * 1000),
  };
}

export async function syncSchedules(deps: ScheduleSyncDeps): Promise<ScheduleSyncResult> {
  const now = deps.now();
  const raw = await deps.fetchSessions();

  if (!Array.isArray(raw)) {
    deps.emitMetric("ScheduleSyncBadResponse", 1);
    return { upserted: [], deleted: [], skipped: 0, inferenceUpserted: [], inferenceDeleted: [] };
  }

  const validated: Session[] = [];
  let skipped = 0;
  for (const item of raw) {
    const result = SessionSchema.safeParse(item);
    if (result.success) validated.push(result.data);
    else skipped += 1;
  }
  if (skipped > 0) deps.emitMetric("SchemaValidationFailure", skipped, { stage: "schedule-sync" });

  const upcoming = pickUpcomingSessions(validated, now);
  const upserted: IngestScheduleSpec[] = [];
  for (const session of upcoming) {
    const spec = toIngestSpec(session);
    // aws-scheduler rejects a one-time `at()` in the past. A session that
    // already went free before this run is handled by the backfill path, not
    // by silently creating a schedule that can never fire.
    if (spec.runAt <= now) continue;
    await deps.upsertIngestSchedule(spec);
    upserted.push(spec);
  }

  // Phase 4: a one-shot inference schedule per upcoming race, T-60min before
  // start. Skip a race whose pre-race window has already passed (`runAt <= now`)
  // — aws-scheduler rejects a one-time `at()` in the past.
  const inferenceUpserted: InferenceScheduleSpec[] = [];
  for (const session of upcoming) {
    if (!isRace(session)) continue;
    const spec = toInferenceSpec(session, raceRound(session, validated), deps.modelVersion);
    if (spec.runAt <= now) continue;
    await deps.upsertInferenceSchedule(spec);
    inferenceUpserted.push(spec);
  }

  // Sweep stale schedules of both kinds: a prefix-matching name that no longer
  // maps to a relevant session. Keeps the scheduler clean across the off-season
  // and after cancellations.
  const wantedIngest = new Set(upserted.map((s) => s.name));
  const wantedInfer = new Set(inferenceUpserted.map((s) => s.name));
  const existing = await deps.listExistingSchedules();
  const deleted: string[] = [];
  const inferenceDeleted: string[] = [];
  for (const name of existing) {
    if (name.startsWith(LEGACY_POLL_PREFIX)) {
      // Pre-Phase-9 leftover: a recurring 5s poll window that can only ever
      // produce 401s now. Delete unconditionally.
      await deps.deleteSchedule(name);
      deleted.push(name);
    } else if (name.startsWith(INGEST_SCHEDULE_PREFIX)) {
      if (wantedIngest.has(name)) continue;
      // Keep a not-yet-fired ingest for a session that has already ended but
      // whose free window hasn't opened — it self-deletes once it fires.
      const key = Number(name.slice(INGEST_SCHEDULE_PREFIX.length));
      const pending = validated.find((s) => s.session_key === key && toIngestSpec(s).runAt > now);
      if (pending) continue;
      await deps.deleteSchedule(name);
      deleted.push(name);
    } else if (name.startsWith(INFERENCE_SCHEDULE_PREFIX)) {
      if (wantedInfer.has(name)) continue;
      // Keep an inference schedule whose race is still active or upcoming (it
      // self-deletes after firing); only sweep ones for vanished/past races.
      const key = Number(name.slice(INFERENCE_SCHEDULE_PREFIX.length));
      const stillRelevant = validated.find(
        (s) => s.session_key === key && (isSessionActive(s, now) || new Date(s.date_start) > now),
      );
      if (stillRelevant) continue;
      await deps.deleteSchedule(name);
      inferenceDeleted.push(name);
    }
  }

  deps.emitMetric("ScheduleSyncUpserts", upserted.length);
  deps.emitMetric("InferenceScheduleUpserts", inferenceUpserted.length);
  return { upserted, deleted, skipped, inferenceUpserted, inferenceDeleted };
}
