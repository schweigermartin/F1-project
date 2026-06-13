import { PipelineEventSchema, S3_PATHS } from "@f1/shared";

/**
 * Archiver logic. Runs on a 15-min schedule. For each session whose parts
 * folder hasn't been touched in the last `idleMinutes`, merges all parts
 * into a single sorted JSONL `raw/sessions/<date>/<session_id>.jsonl` and
 * deletes the parts.
 *
 * Idempotent: if the final file already exists, the session is skipped.
 */

const DEFAULT_IDLE_MINUTES = 30;

export interface PartObject {
  key: string;
  lastModified: Date;
  size: number;
}

export interface ArchiverDeps {
  /** List part objects under a prefix. Pagination handled by the caller. */
  listParts: (prefix: string) => Promise<PartObject[]>;
  /** Returns true if a key exists. */
  objectExists: (key: string) => Promise<boolean>;
  /** Get raw text of a part. */
  getObjectText: (key: string) => Promise<string>;
  /** Write the consolidated JSONL. */
  putObject: (key: string, body: string) => Promise<void>;
  /** Delete a part (or batch — caller may chunk). */
  deleteObjects: (keys: string[]) => Promise<void>;
  /** Sessions whose parts folders to consider. Discovery is caller's job. */
  listActiveSessionFolders: () => Promise<Array<{ date: string; session_id: string }>>;
  /**
   * Phase 5 (AC-1): announce a consolidated session on the event bus so the
   * Evaluation lambda can score the race. Best-effort — a failure must not
   * fail the archive run (the archive itself is durable, and a retried run
   * would skip the session as `skippedExisting` without re-notifying anyway);
   * it is surfaced via the ArchiverNotifyFailures metric/alarm instead, and
   * the evaluation can be re-triggered manually (see retraining runbook).
   */
  notifySessionArchived: (date: string, session_id: string) => Promise<void>;
  now: () => Date;
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export interface ArchiverResult {
  consolidated: Array<{ date: string; session_id: string; rows: number; parts: number }>;
  skippedExisting: number;
  skippedStillActive: number;
}

interface ParsedPart {
  key: string;
  /** Each line is one PipelineEvent JSON. Mixed endpoints in one part. */
  lines: Array<{ fetched_at: string; endpoint: string; line: string }>;
}

function parsePartBody(body: string): ParsedPart["lines"] {
  const out: ParsedPart["lines"] = [];
  for (const raw of body.split("\n")) {
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      const env = PipelineEventSchema.safeParse(obj);
      if (env.success) {
        out.push({ fetched_at: env.data.fetched_at, endpoint: env.data.endpoint, line: raw });
      }
    } catch {
      // Drop unparseable lines silently — Archiver should never block on bad
      // archive data, that's already in S3 by mistake.
    }
  }
  return out;
}

export async function archive(deps: ArchiverDeps): Promise<ArchiverResult> {
  const folders = await deps.listActiveSessionFolders();
  const result: ArchiverResult = { consolidated: [], skippedExisting: 0, skippedStillActive: 0 };
  const idleThreshold = deps.now().getTime() - DEFAULT_IDLE_MINUTES * 60 * 1000;

  for (const { date, session_id } of folders) {
    const finalKey = S3_PATHS.rawSession(date, session_id);
    if (await deps.objectExists(finalKey)) {
      result.skippedExisting += 1;
      continue;
    }

    const prefix = S3_PATHS.rawSessionPartsPrefix(date, session_id);
    const parts = await deps.listParts(prefix);
    if (parts.length === 0) continue;

    const newest = Math.max(...parts.map((p) => p.lastModified.getTime()));
    if (newest > idleThreshold) {
      // Session still seems active — wait for the next Archiver tick.
      result.skippedStillActive += 1;
      continue;
    }

    const collected: ParsedPart["lines"] = [];
    for (const p of parts) {
      const body = await deps.getObjectText(p.key);
      collected.push(...parsePartBody(body));
    }
    collected.sort((a, b) => {
      // Primary sort: fetched_at; ties broken by endpoint name for determinism.
      const cmp = a.fetched_at.localeCompare(b.fetched_at);
      return cmp !== 0 ? cmp : a.endpoint.localeCompare(b.endpoint);
    });

    await deps.putObject(finalKey, collected.map((c) => c.line).join("\n") + "\n");
    await deps.deleteObjects(parts.map((p) => p.key));

    result.consolidated.push({ date, session_id, rows: collected.length, parts: parts.length });
    deps.emitMetric("SessionsArchived", 1, { session_id });

    try {
      await deps.notifySessionArchived(date, session_id);
    } catch {
      deps.emitMetric("ArchiverNotifyFailures", 1, { session_id });
    }
  }

  return result;
}
