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

export interface ScheduleSpec {
  name: string;
  session_key: number;
  startsAt: Date;
  endsAt: Date;
}

export interface ScheduleSyncDeps {
  fetchSessions: () => Promise<unknown>;
  /** Returns existing schedule names matching our prefix. */
  listExistingSchedules: () => Promise<string[]>;
  upsertSchedule: (spec: ScheduleSpec) => Promise<void>;
  deleteSchedule: (name: string) => Promise<void>;
  now: () => Date;
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export interface ScheduleSyncResult {
  upserted: ScheduleSpec[];
  deleted: string[];
  skipped: number;
}

export const SCHEDULE_NAME_PREFIX = "f1-poll-";

function scheduleNameFor(session_key: number): string {
  return `${SCHEDULE_NAME_PREFIX}${session_key}`;
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
    return { upserted: [], deleted: [], skipped: 0 };
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

  // Sweep stale schedules: anything matching our prefix that doesn't map
  // to a known upcoming session_key. Keeps the scheduler clean across the
  // off-season and after cancellations.
  const wantedNames = new Set(upserted.map((s) => s.name));
  const existing = await deps.listExistingSchedules();
  const deleted: string[] = [];
  for (const name of existing) {
    if (!name.startsWith(SCHEDULE_NAME_PREFIX)) continue;
    if (wantedNames.has(name)) continue;
    // Don't kill a currently-running session window.
    const key = Number(name.slice(SCHEDULE_NAME_PREFIX.length));
    const stillRunning = validated.find((s) => s.session_key === key && isSessionActive(s, now));
    if (stillRunning) continue;
    await deps.deleteSchedule(name);
    deleted.push(name);
  }

  deps.emitMetric("ScheduleSyncUpserts", upserted.length);
  return { upserted, deleted, skipped };
}
