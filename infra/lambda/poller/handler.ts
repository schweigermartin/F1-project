import {
  ENDPOINT_PAYLOAD_SCHEMAS,
  OPENF1_DATA_ENDPOINTS,
  type OpenF1DataEndpoint,
  PIPELINE_EVENT_SCHEMA_VERSION,
  type PipelineEvent,
} from "@f1/shared";

/**
 * Pure Poller logic — separated from the Lambda entrypoint (index.ts) so
 * unit tests can drive it without booting the AWS SDK.
 *
 * One handler invocation = one snapshot:
 *   - Iterates the 5 data endpoints SEQUENTIALLY (T1 spike: OpenF1 caps at
 *     ~4 RPS; a 5-endpoint parallel burst flirts with 429).
 *   - `weather` is skipped on most ticks — it changes slowly and a 30s
 *     cadence is plenty (plan §3).
 *   - For each endpoint: GET → validate via per-endpoint Zod schema →
 *     publish one SQS message wrapping the full payload.
 *
 * Failure model:
 *   - 429: exponential backoff (capped at MAX_RETRIES tries per endpoint),
 *     then skip this endpoint for the tick. Do NOT throw the whole tick.
 *   - 5xx / network: log, skip the endpoint.
 *   - Schema-fail: log + emit `SchemaValidationFailure`, skip the endpoint
 *     (the Consumer's second validation is the catch-all).
 */

export interface PollerEvent {
  session_key: number;
}

export interface PollerDeps {
  /** Stubbed in tests; in prod = global fetch. */
  fetch: typeof globalThis.fetch;
  /** Sends one SQS message at a time (matches @aws-sdk SendMessageCommand). */
  sendMessage: (body: string) => Promise<void>;
  /** Wall-clock injection so tests can pin `fetched_at` and weather cadence. */
  now: () => Date;
  /** Delay primitive — pure async sleep, overridden in tests to skip waits. */
  sleep: (ms: number) => Promise<void>;
  /** Fire-and-forget metric — tests assert on the recorded entries. */
  emitMetric: (name: string, value: number, dimensions?: Record<string, string>) => void;
}

export interface PollerSummary {
  session_key: number;
  attempted: number;
  succeeded: number;
  schema_failures: number;
  http_failures: number;
  endpoints: Record<OpenF1DataEndpoint, "ok" | "skipped" | "schema-fail" | "http-fail">;
}

const OPENF1_BASE = "https://api.openf1.org/v1";
const MAX_RETRIES = 3; // initial + 2 retries on 429
const WEATHER_INTERVAL_SECONDS = 30;

/** Tick cadence inside one invocation (plan §3: 5s snapshots). */
export const POLL_INTERVAL_MS = 5_000;
/** How long one invocation keeps ticking. aws-scheduler's smallest recurring
 * rate is 1 minute (rate(5 seconds) is rejected with a ValidationException —
 * found in production), so the scheduler fires once per minute and this loop
 * fills the minute with 5s ticks. 55s leaves margin under the λ timeout. */
export const POLL_WINDOW_MS = 55_000;

/**
 * Weather should fire once per 30s window. With a 5s tick rule, the first
 * tick of each 30s window matches `seconds % 30 < 5`. Stateless (no DDB
 * call) and deterministic given the wall clock.
 */
export function shouldPollWeather(now: Date): boolean {
  return now.getUTCSeconds() % WEATHER_INTERVAL_SECONDS < 5;
}

export function endpointUrl(endpoint: OpenF1DataEndpoint, sessionKey: number): string {
  return `${OPENF1_BASE}/${endpoint}?session_key=${sessionKey}`;
}

interface FetchSuccess {
  kind: "ok";
  payload: unknown;
}
interface FetchFailure {
  kind: "http-fail" | "rate-limited";
  status?: number;
}

async function fetchWithBackoff(
  url: string,
  deps: Pick<PollerDeps, "fetch" | "sleep">,
): Promise<FetchSuccess | FetchFailure> {
  let delay = 1000;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await deps.fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch {
      // network error — treat as transient http-fail, no retry
      return { kind: "http-fail" };
    }

    if (response.ok) {
      return { kind: "ok", payload: await response.json() };
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      // Honor Retry-After if present (T1 spike: server sends `Retry-After: 1`).
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay;
      await deps.sleep(wait);
      delay *= 2;
      continue;
    }

    return {
      kind: response.status === 429 ? "rate-limited" : "http-fail",
      status: response.status,
    };
  }
  /* c8 ignore next */ return { kind: "http-fail" }; // unreachable
}

/**
 * One scheduler firing = one minute of 5s snapshots. Ticks `pollOnce` every
 * POLL_INTERVAL_MS until POLL_WINDOW_MS is used up (wall-clock via deps.now,
 * so a slow tick eats into the window instead of overrunning the λ timeout).
 * Returns every tick's summary; the adapter logs them as one line.
 *
 * `deadlineMs` is an absolute epoch-ms ceiling (typically derived from
 * `context.getRemainingTimeInMillis()`) passed into each tick so that
 * individual endpoint fetches are skipped when time is exhausted — preventing
 * the Lambda timeout that occurred when OpenF1 was heavily rate-limiting during
 * a live race and per-tick backoff blew past 75 s.
 */
export async function pollSession(
  event: PollerEvent,
  deps: PollerDeps,
  windowMs: number = POLL_WINDOW_MS,
  deadlineMs?: number,
): Promise<PollerSummary[]> {
  const startedAt = deps.now().getTime();
  const summaries: PollerSummary[] = [];
  for (;;) {
    const tickStart = deps.now().getTime();
    summaries.push(await pollOnce(event, deps, deadlineMs));
    const nextTickAt = tickStart + POLL_INTERVAL_MS;
    if (nextTickAt >= startedAt + windowMs) break;
    const wait = nextTickAt - deps.now().getTime();
    if (wait > 0) await deps.sleep(wait);
  }
  return summaries;
}

export async function pollOnce(
  event: PollerEvent,
  deps: PollerDeps,
  deadlineMs?: number,
): Promise<PollerSummary> {
  const now = deps.now();
  const fetched_at = now.toISOString();
  const session_id = String(event.session_key);

  const summary: PollerSummary = {
    session_key: event.session_key,
    attempted: 0,
    succeeded: 0,
    schema_failures: 0,
    http_failures: 0,
    endpoints: {
      position: "skipped",
      intervals: "skipped",
      laps: "skipped",
      stints: "skipped",
      weather: "skipped",
    },
  };

  const pollWeather = shouldPollWeather(now);

  for (const endpoint of OPENF1_DATA_ENDPOINTS) {
    if (endpoint === "weather" && !pollWeather) continue;
    if (deadlineMs !== undefined && deps.now().getTime() >= deadlineMs) break;
    summary.attempted += 1;

    const result = await fetchWithBackoff(endpointUrl(endpoint, event.session_key), deps);
    if (result.kind !== "ok") {
      summary.endpoints[endpoint] = "http-fail";
      summary.http_failures += 1;
      deps.emitMetric("PollerHttpFailure", 1, { endpoint, status: String(result.status ?? "n/a") });
      continue;
    }

    const validation = ENDPOINT_PAYLOAD_SCHEMAS[endpoint].safeParse(result.payload);
    if (!validation.success) {
      summary.endpoints[endpoint] = "schema-fail";
      summary.schema_failures += 1;
      deps.emitMetric("SchemaValidationFailure", 1, { endpoint, stage: "poller" });
      continue;
    }

    const message: PipelineEvent = {
      session_id,
      endpoint,
      payload: validation.data,
      fetched_at,
      schema_version: PIPELINE_EVENT_SCHEMA_VERSION,
    };
    await deps.sendMessage(JSON.stringify(message));
    summary.endpoints[endpoint] = "ok";
    summary.succeeded += 1;
  }

  return summary;
}
