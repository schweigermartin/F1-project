import { PIPELINE_EVENT_SCHEMA_VERSION, type ServerMessage } from "@f1/shared";
import { describe, expect, it, vi } from "vitest";

import { expandLines, handleReplay, type ReplayDeps } from "../handler.js";

const T0 = "2026-05-24T20:00:00.000+00:00";
const T1 = "2026-05-24T20:00:01.000+00:00"; // +1000ms

function line(endpoint: string, fetched_at: string, payload: unknown[]): string {
  return JSON.stringify({
    session_id: "11291",
    endpoint,
    payload,
    fetched_at,
    schema_version: PIPELINE_EVENT_SCHEMA_VERSION,
  });
}

const LINES = [
  // deliberately out of chronological order to prove the sort
  line("position", T1, [{ driver_number: 44, position: 1 }]),
  line("position", T0, [
    { driver_number: 44, position: 2 },
    { driver_number: 1, position: 1 },
  ]),
];

describe("expandLines", () => {
  it("expands rows into deltas, chronologically sorted, mapping endpoint→entity", () => {
    const tl = expandLines(LINES, "11291");
    // T0 has 2 rows, T1 has 1 → 3 deltas, T0 ones first
    expect(tl).toHaveLength(3);
    expect(tl[0]!.t).toBeLessThanOrEqual(tl[2]!.t);
    expect(tl[0]!.message.entity).toBe("position");
    expect(tl.every((d) => d.message.type === "delta")).toBe(true);
  });

  it("skips malformed and unparseable lines", () => {
    const tl = expandLines(["not json", "", JSON.stringify({ nope: true }), LINES[0]!], "11291");
    expect(tl).toHaveLength(1);
  });

  it("maps intervals→interval and stints→stint", () => {
    const tl = expandLines(
      [
        line("intervals", T0, [{ driver_number: 44, gap_to_leader: 1.2, interval: 1.2 }]),
        line("stints", T0, [{ driver_number: 44, stint_number: 1, compound: "SOFT" }]),
      ],
      "11291",
    );
    expect(tl.map((d) => d.message.entity).sort()).toEqual(["interval", "stint"]);
  });
});

function deps(over: Partial<ReplayDeps> = {}): {
  d: ReplayDeps;
  posted: ServerMessage[];
  sleeps: number[];
} {
  const posted: ServerMessage[] = [];
  const sleeps: number[] = [];
  const d: ReplayDeps = {
    loadLines: vi.fn().mockResolvedValue(LINES),
    post: vi.fn(async (m: ServerMessage) => {
      posted.push(m);
    }),
    isAborted: vi.fn().mockResolvedValue(false),
    scheduleContinuation: vi.fn().mockResolvedValue(undefined),
    now: () => 0,
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
    }),
    emitMetric: vi.fn(),
    ...over,
  };
  return { d, posted, sleeps };
}

describe("handleReplay", () => {
  it("posts session-not-archived when the file is missing", async () => {
    const { d, posted } = deps({ loadLines: vi.fn().mockResolvedValue(null) });
    const r = await handleReplay({ session_id: "x", speed: 1 }, d);
    expect(r.outcome).toBe("not-archived");
    expect(posted).toEqual([{ type: "info", code: "session-not-archived" }]);
  });

  it("plays the whole timeline and ends with replay:end", async () => {
    const { d, posted } = deps();
    const r = await handleReplay({ session_id: "11291", speed: 1 }, d);
    expect(r).toMatchObject({ outcome: "done", posted: 3 });
    expect(posted.at(-1)).toEqual({ type: "replay:end", session_id: "11291" });
  });

  it.each([
    [1, 1000],
    [2, 500],
    [4, 250],
  ] as const)("scales inter-event waits by speed %i× → %ims", async (speed, expected) => {
    const { d, sleeps } = deps();
    await handleReplay({ session_id: "11291", speed }, d);
    // last delta (T1, +1000ms from chunk start) waits 1000/speed
    expect(sleeps.at(-1)).toBe(expected);
  });

  it("self-continues when over the wall budget, handing off the next cursor", async () => {
    const { d } = deps();
    const r = await handleReplay({ session_id: "11291", speed: 1, wallBudgetMs: 0 }, d);
    expect(r.outcome).toBe("continued");
    expect(r.cursor).toBe(1);
    expect(d.scheduleContinuation).toHaveBeenCalledWith(1);
  });

  it("resumes from a cursor without replaying earlier events", async () => {
    const { d, posted } = deps();
    const r = await handleReplay({ session_id: "11291", speed: 1, cursor: 2 }, d);
    expect(r.outcome).toBe("done");
    // only the 3rd delta + replay:end
    expect(posted).toHaveLength(2);
  });

  it("stops when aborted (replayStop / disconnect / superseded)", async () => {
    const { d, posted } = deps({ isAborted: vi.fn().mockResolvedValue(true) });
    const r = await handleReplay({ session_id: "11291", speed: 1 }, d);
    expect(r.outcome).toBe("aborted");
    expect(posted).toHaveLength(0);
  });

  it("stops on a 410-gone connection without throwing", async () => {
    const post = vi.fn().mockRejectedValue({ gone: true });
    const { d } = deps({ post });
    const r = await handleReplay({ session_id: "11291", speed: 1 }, d);
    expect(r.outcome).toBe("gone");
  });

  it("rethrows a real post error", async () => {
    const post = vi.fn().mockRejectedValue(new Error("throttled"));
    const { d } = deps({ post });
    await expect(handleReplay({ session_id: "11291", speed: 1 }, d)).rejects.toThrow("throttled");
  });
});
