import { PIPELINE_EVENT_SCHEMA_VERSION, type PipelineEvent } from "@f1/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  endpointUrl,
  type PollerDeps,
  type PollerEvent,
  pollOnce,
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
