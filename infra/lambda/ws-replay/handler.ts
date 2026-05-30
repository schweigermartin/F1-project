import { PipelineEventSchema, type ServerMessage } from "@f1/shared";

/**
 * Replay logic. Pure DI — index.ts wires S3, the connections-table abort
 * check, the ApiGw management client, and the self-invoke continuation.
 *
 * Plays an archived session's JSONL back over the SAME WebSocket as live, so
 * the frontend renders it identically (R-2). Events are paced by
 * `(fetched_at - chunkStart) / speed`.
 *
 * Long sessions outrun the 15-min Lambda wall, so a single invocation plays a
 * bounded wall-budget chunk, then re-invokes itself with the next cursor
 * (Self-Continuation, R-3). A replayId guards the chain: replay:stop /
 * disconnect / a fresh replay:start all make `isAborted` return true, so an
 * orphaned chain dies on its next abort check.
 */

export const REPLAY_WALL_BUDGET_MS = 10 * 60_000; // 10 min, leaves headroom under the 15-min cap
export const ABORT_CHECK_INTERVAL = 20; // check the connection row every N deltas

/** OpenF1 endpoint (as archived) → delta entity (as the frontend reducer keys). */
const ENDPOINT_TO_ENTITY: Record<string, ServerMessageDelta["entity"]> = {
  position: "position",
  intervals: "interval",
  laps: "lap",
  stints: "stint",
  weather: "weather",
};

type ServerMessageDelta = Extract<ServerMessage, { type: "delta" }>;

export interface TimedDelta {
  t: number; // fetched_at as epoch ms
  message: ServerMessageDelta;
}

export interface ReplayInput {
  session_id: string;
  speed: 1 | 2 | 4;
  /** Resume index into the timeline; 0 on a fresh replay:start. */
  cursor?: number;
  /** Injectable for tests; defaults to REPLAY_WALL_BUDGET_MS. */
  wallBudgetMs?: number;
}

export interface ReplayDeps {
  /** Load the archived JSONL lines for a session, or null if not archived. */
  loadLines: (sessionId: string) => Promise<string[] | null>;
  /** PostToConnection; reject with `{ gone: true }` on a 410. */
  post: (message: ServerMessage) => Promise<void>;
  /** True if the replay should stop (disconnect / replay:stop / superseded). */
  isAborted: () => Promise<boolean>;
  /** Async self-invoke to play the next chunk from `cursor`. */
  scheduleContinuation: (cursor: number) => Promise<void>;
  /** Wall clock in ms. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export type ReplayOutcome = "not-archived" | "done" | "aborted" | "gone" | "continued";

export interface ReplayResult {
  outcome: ReplayOutcome;
  posted: number;
  cursor?: number;
}

function isGone(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "gone" in err &&
    (err as { gone?: unknown }).gone === true
  );
}

/**
 * Parse archived PipelineEvent lines into a flat, chronologically sorted
 * timeline of deltas (one per row). Invalid lines are skipped.
 */
export function expandLines(lines: string[], session_id: string): TimedDelta[] {
  const out: TimedDelta[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const ev = PipelineEventSchema.safeParse(json);
    if (!ev.success) continue;

    const entity = ENDPOINT_TO_ENTITY[ev.data.endpoint];
    if (!entity) continue;

    const t = Date.parse(ev.data.fetched_at);
    const rows = Array.isArray(ev.data.payload) ? ev.data.payload : [];
    for (const row of rows) {
      out.push({ t, message: { type: "delta", session_id, entity, data: row } });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export async function handleReplay(input: ReplayInput, deps: ReplayDeps): Promise<ReplayResult> {
  const lines = await deps.loadLines(input.session_id);
  if (lines === null) {
    await deps.post({ type: "info", code: "session-not-archived" });
    return { outcome: "not-archived", posted: 0 };
  }

  const timeline = expandLines(lines, input.session_id);
  const cursor = input.cursor ?? 0;
  const budget = input.wallBudgetMs ?? REPLAY_WALL_BUDGET_MS;

  if (timeline.length === 0 || cursor >= timeline.length) {
    await deps.post({ type: "replay:end", session_id: input.session_id });
    return { outcome: "done", posted: 0 };
  }

  const chunkStart = timeline[cursor]!.t;
  const wallStart = deps.now();
  let posted = 0;

  for (let i = cursor; i < timeline.length; i++) {
    const td = timeline[i]!;

    if (i % ABORT_CHECK_INTERVAL === 0 && (await deps.isAborted())) {
      deps.emitMetric("ReplayAborted", 1);
      return { outcome: "aborted", posted };
    }

    const wait = (td.t - chunkStart) / input.speed - (deps.now() - wallStart);
    if (wait > 0) await deps.sleep(wait);

    try {
      await deps.post(td.message);
      posted += 1;
    } catch (err) {
      if (isGone(err)) {
        deps.emitMetric("ReplayGone", 1);
        return { outcome: "gone", posted };
      }
      throw err;
    }

    if (deps.now() - wallStart >= budget && i + 1 < timeline.length) {
      await deps.scheduleContinuation(i + 1);
      deps.emitMetric("ReplayChunk", 1);
      return { outcome: "continued", posted, cursor: i + 1 };
    }
  }

  await deps.post({ type: "replay:end", session_id: input.session_id });
  deps.emitMetric("ReplayChunk", 1);
  return { outcome: "done", posted };
}
