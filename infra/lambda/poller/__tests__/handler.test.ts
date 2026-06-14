import { PIPELINE_EVENT_SCHEMA_VERSION, type PipelineEvent } from "@f1/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  endpointUrl,
  POLL_WINDOW_MS,
  type PollerDeps,
  type PollerEvent,
  pollOnce,
  pollSession,
  shouldPollWeather,
} from "../handler.js";

// ─── Fixture rows (minimal valid examples derived from T1 spike) ──────────
const positionRow = {
  date: "2026-05-24T19:07:20.910000+00:00",
  session_key: 11291,
  meeting_key: 1285,
  driver_number: 63,
  position: 1,
};

const intervalRow = {
  date: "2026-05-24T19:07:54.848000+00:00",
  session_key: 11291,
  meeting_key: 1285,
  driver_number: 63,
  gap_to_leader: 0,
  interval: 0,
};

const lapRow = {
  meeting_key: 1285,
  session_key: 11291,
  driver_number: 63,
  lap_number: 1,
  date_start: null,
  duration_sector_1: null,
  duration_sector_2: null,
  duration_sector_3: null,
  i1_speed: null,
  i2_speed: null,
  is_pit_out_lap: false,
  lap_duration: null,
};

const stintRow = {
  meeting_key: 1285,
  session_key: 11291,
  stint_number: 1,
  driver_number: 63,
  lap_start: 1,
  lap_end: 1,
  compound: "MEDIUM",
  tyre_age_at_start: 0,
};

const weatherRow = {
  date: "2026-05-24T19:07:46.504000+00:00",
  session_key: 11291,
  meeting_key: 1285,
  pressure: 1025.5,
  humidity: 74.4,
  wind_direction: 185,
  air_temperature: 12.4,
  track_temperature: 17.2,
  wind_speed: 5.7,
  rainfall: 0,
};

// ─── Test helpers ─────────────────────────────────────────────────────────
const SESSION_KEY = 11291;
const evt: PollerEvent = { session_key: SESSION_KEY };

interface ResponseSpec {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function jsonResponse(spec: ResponseSpec): Response {
  return new Response(JSON.stringify(spec.body ?? null), {
    status: spec.status,
    headers: spec.headers,
  });
}

interface Mocks {
  fetch: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  emitMetric: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
  deps: PollerDeps;
}

function makeMocks(opts: {
  now?: Date;
  respondTo?: (url: string) => ResponseSpec | ResponseSpec[];
}): Mocks {
  const respondTo = opts.respondTo ?? (() => ({ status: 200, body: [] }));
  const queue = new Map<string, ResponseSpec[]>();

  const fetch = vi.fn(async (url: string | URL): Promise<Response> => {
    const key = url.toString();
    if (!queue.has(key)) {
      const spec = respondTo(key);
      queue.set(key, Array.isArray(spec) ? [...spec] : [spec]);
    }
    const specs = queue.get(key)!;
    // Drain scripted sequences, but hold the LAST item forever — that way
    // both "[429, 200]" and "[429]" do the intuitive thing.
    const next = specs.length > 1 ? specs.shift()! : specs[0]!;
    return jsonResponse(next);
  });
  const sendMessage = vi.fn(async (_body: string) => {});
  const emitMetric = vi.fn();
  const sleep = vi.fn(async (_ms: number) => {}); // pure no-op so tests stay fast

  return {
    fetch,
    sendMessage,
    emitMetric,
    sleep,
    deps: {
      fetch: fetch as unknown as typeof globalThis.fetch,
      sendMessage,
      now: () => opts.now ?? new Date("2026-05-24T20:30:00.000Z"), // :00 → weather tick
      sleep,
      emitMetric,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────
describe("shouldPollWeather", () => {
  it("fires in the first 5 seconds of each 30s window", () => {
    expect(shouldPollWeather(new Date("2026-05-24T20:30:00.000Z"))).toBe(true);
    expect(shouldPollWeather(new Date("2026-05-24T20:30:02.000Z"))).toBe(true);
    expect(shouldPollWeather(new Date("2026-05-24T20:30:04.000Z"))).toBe(true);
  });

  it("does not fire outside the first 5 seconds", () => {
    expect(shouldPollWeather(new Date("2026-05-24T20:30:05.000Z"))).toBe(false);
    expect(shouldPollWeather(new Date("2026-05-24T20:30:15.000Z"))).toBe(false);
    expect(shouldPollWeather(new Date("2026-05-24T20:30:25.000Z"))).toBe(false);
  });

  it("fires again at :30 (next 30s window)", () => {
    expect(shouldPollWeather(new Date("2026-05-24T20:30:30.000Z"))).toBe(true);
  });
});

describe("endpointUrl", () => {
  it("builds the singular /position URL (T1 spike finding)", () => {
    expect(endpointUrl("position", 11291)).toBe(
      "https://api.openf1.org/v1/position?session_key=11291",
    );
  });
});

describe("pollOnce — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("polls all 5 endpoints when weather tick is active", async () => {
    const m = makeMocks({
      respondTo: (url) => {
        if (url.includes("/position")) return { status: 200, body: [positionRow] };
        if (url.includes("/intervals")) return { status: 200, body: [intervalRow] };
        if (url.includes("/laps")) return { status: 200, body: [lapRow] };
        if (url.includes("/stints")) return { status: 200, body: [stintRow] };
        if (url.includes("/weather")) return { status: 200, body: [weatherRow] };
        return { status: 500 };
      },
    });
    const summary = await pollOnce(evt, m.deps);

    expect(summary.attempted).toBe(5);
    expect(summary.succeeded).toBe(5);
    expect(summary.http_failures).toBe(0);
    expect(summary.schema_failures).toBe(0);
    expect(m.sendMessage).toHaveBeenCalledTimes(5);
  });

  it("skips weather when the wall clock is outside the 30s window", async () => {
    const m = makeMocks({
      now: new Date("2026-05-24T20:30:15.000Z"), // 15s into window → no weather
      respondTo: (url) => {
        if (url.includes("/position")) return { status: 200, body: [positionRow] };
        if (url.includes("/intervals")) return { status: 200, body: [intervalRow] };
        if (url.includes("/laps")) return { status: 200, body: [lapRow] };
        if (url.includes("/stints")) return { status: 200, body: [stintRow] };
        return { status: 200, body: [weatherRow] };
      },
    });
    const summary = await pollOnce(evt, m.deps);

    expect(summary.attempted).toBe(4);
    expect(summary.endpoints.weather).toBe("skipped");
    expect(m.fetch).toHaveBeenCalledTimes(4);
    expect(m.sendMessage).toHaveBeenCalledTimes(4);
  });

  it("publishes well-formed PipelineEvent messages", async () => {
    const m = makeMocks({
      respondTo: () => ({ status: 200, body: [positionRow] }),
    });
    await pollOnce(evt, m.deps);

    const firstCall = m.sendMessage.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const parsed = JSON.parse(firstCall as string) as PipelineEvent;
    expect(parsed.session_id).toBe("11291");
    expect(parsed.schema_version).toBe(PIPELINE_EVENT_SCHEMA_VERSION);
    expect(parsed.endpoint).toBeTruthy();
    expect(parsed.fetched_at).toBeTruthy();
  });
});

describe("pollOnce — backoff on 429", () => {
  it("retries with exponential backoff, then succeeds", async () => {
    const m = makeMocks({
      respondTo: (url) => {
        if (url.includes("/position")) {
          return [
            { status: 429, headers: { "retry-after": "1" } },
            { status: 200, body: [positionRow] },
          ];
        }
        return { status: 200, body: [] };
      },
    });
    const summary = await pollOnce(evt, m.deps);

    expect(summary.endpoints.position).toBe("ok");
    expect(m.sleep).toHaveBeenCalledTimes(1);
    expect(m.sleep).toHaveBeenCalledWith(1000); // Retry-After: 1 → 1000ms
  });

  it("gives up after MAX_RETRIES and skips the endpoint", async () => {
    const m = makeMocks({
      respondTo: () => ({ status: 429, headers: { "retry-after": "1" } }),
    });
    const summary = await pollOnce(evt, m.deps);

    expect(summary.succeeded).toBe(0);
    expect(summary.http_failures).toBe(summary.attempted);
    expect(m.emitMetric).toHaveBeenCalledWith(
      "PollerHttpFailure",
      1,
      expect.objectContaining({ status: "429" }),
    );
  });
});

describe("pollOnce — schema validation failures", () => {
  it("emits SchemaValidationFailure metric and skips the endpoint", async () => {
    const m = makeMocks({
      respondTo: (url) => {
        if (url.includes("/position"))
          return { status: 200, body: [{ ...positionRow, position: "not-a-number" }] };
        return { status: 200, body: [] };
      },
    });
    const summary = await pollOnce(evt, m.deps);

    expect(summary.endpoints.position).toBe("schema-fail");
    expect(summary.schema_failures).toBeGreaterThanOrEqual(1);
    expect(m.emitMetric).toHaveBeenCalledWith(
      "SchemaValidationFailure",
      1,
      expect.objectContaining({ endpoint: "position", stage: "poller" }),
    );
    expect(m.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('"endpoint":"position"'),
    );
  });

  it("does not derail other endpoints when one fails validation", async () => {
    const m = makeMocks({
      respondTo: (url) => {
        if (url.includes("/position"))
          return { status: 200, body: [{ ...positionRow, position: "bad" }] };
        if (url.includes("/intervals")) return { status: 200, body: [intervalRow] };
        return { status: 200, body: [] };
      },
    });
    const summary = await pollOnce(evt, m.deps);

    expect(summary.endpoints.position).toBe("schema-fail");
    expect(summary.endpoints.intervals).toBe("ok");
  });
});

describe("pollOnce — network errors", () => {
  it("counts a thrown fetch as http-fail without retrying", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const sendMessage = vi.fn(async () => {});
    const sleep = vi.fn(async () => {});
    const emitMetric = vi.fn();
    const summary = await pollOnce(evt, {
      fetch: fetch as unknown as typeof globalThis.fetch,
      sendMessage,
      now: () => new Date("2026-05-24T20:30:00.000Z"),
      sleep,
      emitMetric,
    });

    expect(summary.http_failures).toBe(summary.attempted);
    expect(sleep).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("pollOnce — deadline ceiling (2026-06-13 rate-limit storm)", () => {
  it("polls every endpoint when the deadline is comfortably in the future", async () => {
    const now = new Date("2026-05-24T20:30:00.000Z"); // :00 → weather tick
    const m = makeMocks({ now, respondTo: () => ({ status: 200, body: [] }) });
    const deadlineMs = now.getTime() + 60_000;

    const summary = await pollOnce(evt, m.deps, deadlineMs);

    expect(summary.attempted).toBe(5);
    expect(m.fetch).toHaveBeenCalledTimes(5);
  });

  it("stops attempting endpoints once the wall clock crosses the deadline", async () => {
    let clock = Date.parse("2026-05-24T20:30:00.000Z");
    const m = makeMocks({});
    m.deps.now = () => new Date(clock);
    // Each fetch burns 10s of wall-clock — simulates per-endpoint 429 backoff
    // during a rate-limit storm. The deadline must short-circuit the loop
    // before it overruns the Lambda timeout.
    const fetch = vi.fn(async (): Promise<Response> => {
      clock += 10_000;
      return new Response(JSON.stringify([]), { status: 200 });
    });
    m.deps.fetch = fetch as unknown as typeof globalThis.fetch;

    // Deadline = start + 25s. The per-endpoint guard runs before each fetch:
    // attempts at clock 0s, 10s, 20s pass; the 4th check (clock 30s) breaks.
    const deadlineMs = clock + 25_000;
    const summary = await pollOnce(evt, m.deps, deadlineMs);

    expect(summary.attempted).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("is a no-op guard when deadlineMs is undefined (back-compat)", async () => {
    const now = new Date("2026-05-24T20:30:00.000Z");
    const m = makeMocks({ now, respondTo: () => ({ status: 200, body: [] }) });

    const summary = await pollOnce(evt, m.deps);

    expect(summary.attempted).toBe(5);
  });
});

describe("pollSession — one minute of 5s ticks (scheduler can't fire sub-minute)", () => {
  /** Virtual clock: now() reads it, sleep() advances it — no real waiting. */
  function makeClockedMocks(start = Date.parse("2026-05-24T20:30:00.000Z")): Mocks & {
    clock: () => number;
  } {
    let clock = start;
    const m = makeMocks({});
    m.deps.now = () => new Date(clock);
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    m.deps.sleep = sleep;
    m.sleep = sleep;
    return { ...m, deps: m.deps, clock: () => clock };
  }

  it("ticks every 5s until the 55s window is full (11 snapshots)", async () => {
    const m = makeClockedMocks();
    const summaries = await pollSession(evt, m.deps);
    expect(summaries).toHaveLength(11); // t = 0, 5, …, 50s
    // Instant ticks → every wait is the full 5s interval.
    expect(m.sleep).toHaveBeenCalledTimes(10);
    expect(m.sleep).toHaveBeenLastCalledWith(5000);
  });

  it("threads deadlineMs into every tick — fetches are skipped once it has passed", async () => {
    const m = makeClockedMocks();
    const alreadyPassed = Date.parse("2026-05-24T20:30:00.000Z") - 1;
    const summaries = await pollSession(evt, m.deps, POLL_WINDOW_MS, alreadyPassed);

    // Window bookkeeping is unaffected — still 11 ticks across 55s …
    expect(summaries).toHaveLength(11);
    // … but the deadline guard means each tick attempts zero endpoints.
    expect(summaries.every((s) => s.attempted === 0)).toBe(true);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("a window smaller than one interval still produces exactly one snapshot", async () => {
    const m = makeClockedMocks();
    const summaries = await pollSession(evt, m.deps, 1000);
    expect(summaries).toHaveLength(1);
    expect(m.sleep).not.toHaveBeenCalled();
  });

  it("a slow tick eats into the window instead of overrunning it", async () => {
    const m = makeClockedMocks();
    let clockBump = 0;
    // First send of each tick simulates 7s of real latency (slower than the
    // 5s interval): the loop must skip the sleep and still end on time.
    const origNow = m.deps.now;
    m.deps.sendMessage = vi.fn(async () => {
      if (clockBump < 2) {
        clockBump += 1;
        await m.deps.sleep(7000);
      }
    });
    void origNow;
    const summaries = await pollSession(evt, m.deps, 20_000);
    // Ticks start at t=0 (runs until 7s), next due at 5s → immediate at 7s,
    // (runs until 14s), next due at 12s → immediate, then instant ticks every
    // 5s until t ≥ 20s.
    const lastTickWithinWindow = m.clock() <= Date.parse("2026-05-24T20:30:00.000Z") + 27_000;
    expect(lastTickWithinWindow).toBe(true);
    expect(summaries.length).toBeGreaterThanOrEqual(3);
  });
});
