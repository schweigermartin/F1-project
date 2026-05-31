import { isSessionActive, type Session, SessionSchema } from "@f1/shared";

/**
 * Schedule-Sync — runs daily, programmes one EventBridge Schedule per
 * upcoming F1 session. Each schedule fires the Poller every 5 seconds
 * during a window of `[date_start - 15min, date_end + 30min]`.
 *
 * Why one-shot-per-session schedules instead of a single rule with
 * enable/disable? aws-scheduler supports a `StartDate`/`EndDate` window
 * natively; no Lambda-side bookkeeping needed.
 *
 * Idempotent — names schedules deterministically (`f1-poll-<session_key>`),
 * upserts via Create-or-Update.
 */

const HORIZON_HOURS = 48;
const PRE_START_MINUTES = 15;
const POST_END_MINUTES = 30;
/** Inference runs once, T-60min before a race start (Phase 4 AC-1 / D5). */
const INFERENCE_LEAD_MINUTES = 60;

export interface ScheduleSpec {
  name: string;
  session_key: number;
  startsAt: Date;
  endsAt: Date;
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
  /** Returns existing schedule names (both f1-poll-* and f1-infer-*). */
  listExistingSchedules: () => Promise<string[]>;
  upsertSchedule: (spec: ScheduleSpec) => Promise<void>;
  upsertInferenceSchedule: (spec: InferenceScheduleSpec) => Promise<void>;
  deleteSchedule: (name: string) => Promise<void>;
  /** Active model version stamped into each inference schedule's input. */
  modelVersion: string;
  now: () => Date;
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export interface ScheduleSyncResult {
  upserted: ScheduleSpec[];
  deleted: string[];
  skipped: number;
  inferenceUpserted: InferenceScheduleSpec[];
  inferenceDeleted: string[];
}

export const SCHEDULE_NAME_PREFIX = "f1-poll-";
export const INFERENCE_SCHEDULE_PREFIX = "f1-infer-";

function scheduleNameFor(session_key: number): string {
  return `${SCHEDULE_NAME_PREFIX}${session_key}`;
}

function isRace(session: Session): boolean {
  return session.session_name === "Race";
}

/** Championship round = this race's 1-based position among the season's races. */
function raceRound(session: Session, allValidated: Session[]): number {
  const races = allValidated
    .filter(isRace)
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

function toSpec(session: Session): ScheduleSpec {
  const start = new Date(session.date_start);
  const end = new Date(session.date_end);
  return {
    name: scheduleNameFor(session.session_key),
    session_key: session.session_key,
    startsAt: new Date(start.getTime() - PRE_START_MINUTES * 60 * 1000),
    endsAt: new Date(end.getTime() + POST_END_MINUTES * 60 * 1000),
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
  const upserted: ScheduleSpec[] = [];
  for (const session of upcoming) {
    const spec = toSpec(session);
    await deps.upsertSchedule(spec);
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
  const wantedPoll = new Set(upserted.map((s) => s.name));
  const wantedInfer = new Set(inferenceUpserted.map((s) => s.name));
  const existing = await deps.listExistingSchedules();
  const deleted: string[] = [];
  const inferenceDeleted: string[] = [];
  for (const name of existing) {
    if (name.startsWith(SCHEDULE_NAME_PREFIX)) {
      if (wantedPoll.has(name)) continue;
      // Don't kill a currently-running session window.
      const key = Number(name.slice(SCHEDULE_NAME_PREFIX.length));
      const stillRunning = validated.find((s) => s.session_key === key && isSessionActive(s, now));
      if (stillRunning) continue;
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
