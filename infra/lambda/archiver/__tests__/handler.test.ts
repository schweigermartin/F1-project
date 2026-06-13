import { PIPELINE_EVENT_SCHEMA_VERSION } from "@f1/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { archive, type ArchiverDeps, type PartObject } from "../handler.js";

const NOW = new Date("2026-05-24T23:30:00.000Z"); // 30+min past last activity
const SESSION = { date: "2026-05-24", session_id: "11291" };

function eventLine(endpoint: string, ts: string, body: unknown = []): string {
  return JSON.stringify({
    session_id: SESSION.session_id,
    endpoint,
    payload: body,
    fetched_at: ts,
    schema_version: PIPELINE_EVENT_SCHEMA_VERSION,
  });
}

function makeMocks(opts: {
  folders?: Array<{ date: string; session_id: string }>;
  parts?: Record<string, PartObject[]>;
  bodies?: Record<string, string>;
  exists?: Set<string>;
}): { deps: ArchiverDeps; mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const parts = opts.parts ?? {};
  const bodies = opts.bodies ?? {};
  const exists = opts.exists ?? new Set<string>();
  const folders = opts.folders ?? [SESSION];

  const listActiveSessionFolders = vi.fn(async () => folders);
  const listParts = vi.fn(async (prefix: string) => parts[prefix] ?? []);
  const objectExists = vi.fn(async (key: string) => exists.has(key));
  const getObjectText = vi.fn(async (key: string) => bodies[key] ?? "");
  const putObject = vi.fn(async (_k: string, _b: string) => {});
  const deleteObjects = vi.fn(async (_keys: string[]) => {});
  const notifySessionArchived = vi.fn(async (_date: string, _sessionId: string) => {});
  const emitMetric = vi.fn();

  return {
    mocks: {
      listActiveSessionFolders,
      listParts,
      objectExists,
      getObjectText,
      putObject,
      deleteObjects,
      notifySessionArchived,
      emitMetric,
    },
    deps: {
      listActiveSessionFolders,
      listParts,
      objectExists,
      getObjectText,
      putObject,
      deleteObjects,
      notifySessionArchived,
      now: () => NOW,
      emitMetric,
    },
  };
}

describe("archive — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges parts into a final sorted JSONL and deletes the parts", async () => {
    const prefix = "raw/sessions/2026-05-24/11291/parts/";
    const partKeys = [`${prefix}a.jsonl`, `${prefix}b.jsonl`];
    const oldEnough = new Date(NOW.getTime() - 31 * 60 * 1000);
    const m = makeMocks({
      parts: {
        [prefix]: [
          { key: partKeys[0]!, lastModified: oldEnough, size: 100 },
          { key: partKeys[1]!, lastModified: oldEnough, size: 100 },
        ],
      },
      bodies: {
        [partKeys[0]!]: [
          eventLine("position", "2026-05-24T20:30:05.000+00:00"),
          eventLine("intervals", "2026-05-24T20:30:00.000+00:00"),
        ].join("\n"),
        [partKeys[1]!]: [eventLine("laps", "2026-05-24T20:30:10.000+00:00")].join("\n"),
      },
    });

    const result = await archive(m.deps);

    expect(result.consolidated).toEqual([
      { date: "2026-05-24", session_id: "11291", rows: 3, parts: 2 },
    ]);
    expect(m.mocks["putObject"]).toHaveBeenCalledWith(
      "raw/sessions/2026-05-24/11291.jsonl",
      expect.any(String),
    );
    const writtenBody = m.mocks["putObject"]!.mock.calls[0]![1] as string;
    const lines = writtenBody
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { fetched_at: string });
    expect(lines[0]!.fetched_at).toBe("2026-05-24T20:30:00.000+00:00");
    expect(lines[2]!.fetched_at).toBe("2026-05-24T20:30:10.000+00:00");
    expect(m.mocks["deleteObjects"]).toHaveBeenCalledWith(partKeys);
    expect(m.mocks["emitMetric"]).toHaveBeenCalledWith(
      "SessionsArchived",
      1,
      expect.objectContaining({ session_id: "11291" }),
    );
  });
});

describe("archive — idempotency + active sessions", () => {
  it("skips sessions whose final file already exists", async () => {
    const m = makeMocks({ exists: new Set(["raw/sessions/2026-05-24/11291.jsonl"]) });
    const result = await archive(m.deps);
    expect(result.skippedExisting).toBe(1);
    expect(m.mocks["listParts"]).not.toHaveBeenCalled();
    expect(m.mocks["putObject"]).not.toHaveBeenCalled();
  });

  it("waits when the most-recent part is still fresh", async () => {
    const prefix = "raw/sessions/2026-05-24/11291/parts/";
    const fresh = new Date(NOW.getTime() - 5 * 60 * 1000);
    const m = makeMocks({
      parts: { [prefix]: [{ key: `${prefix}a.jsonl`, lastModified: fresh, size: 10 }] },
    });
    const result = await archive(m.deps);
    expect(result.skippedStillActive).toBe(1);
    expect(m.mocks["putObject"]).not.toHaveBeenCalled();
    expect(m.mocks["deleteObjects"]).not.toHaveBeenCalled();
  });

  it("processes nothing when there are no parts at all", async () => {
    const m = makeMocks({ parts: {} });
    const result = await archive(m.deps);
    expect(result.consolidated).toHaveLength(0);
    expect(m.mocks["putObject"]).not.toHaveBeenCalled();
  });
});

describe("archive — malformed input tolerance", () => {
  it("silently drops unparseable lines, keeps the rest", async () => {
    const prefix = "raw/sessions/2026-05-24/11291/parts/";
    const oldEnough = new Date(NOW.getTime() - 31 * 60 * 1000);
    const partKey = `${prefix}a.jsonl`;
    const m = makeMocks({
      parts: { [prefix]: [{ key: partKey, lastModified: oldEnough, size: 100 }] },
      bodies: {
        [partKey]: [
          "not-valid-json",
          eventLine("position", "2026-05-24T20:30:05.000+00:00"),
          JSON.stringify({ wrong: "shape" }),
        ].join("\n"),
      },
    });
    const result = await archive(m.deps);
    expect(result.consolidated[0]!.rows).toBe(1);
  });
});

describe("archive — SessionArchived notification (Phase 5, AC-1)", () => {
  function consolidatableSession(): ReturnType<typeof makeMocks> {
    const prefix = "raw/sessions/2026-05-24/11291/parts/";
    const oldEnough = new Date(NOW.getTime() - 31 * 60 * 1000);
    const partKey = `${prefix}a.jsonl`;
    return makeMocks({
      parts: { [prefix]: [{ key: partKey, lastModified: oldEnough, size: 100 }] },
      bodies: { [partKey]: eventLine("position", "2026-05-24T20:30:05.000+00:00") },
    });
  }

  it("notifies exactly once per consolidated session, after the final put", async () => {
    const m = consolidatableSession();
    await archive(m.deps);
    expect(m.mocks["notifySessionArchived"]).toHaveBeenCalledTimes(1);
    expect(m.mocks["notifySessionArchived"]).toHaveBeenCalledWith("2026-05-24", "11291");
    expect(m.mocks["putObject"]!.mock.invocationCallOrder[0]!).toBeLessThan(
      m.mocks["notifySessionArchived"]!.mock.invocationCallOrder[0]!,
    );
  });

  it("does not notify for skipped sessions", async () => {
    const m = makeMocks({ exists: new Set(["raw/sessions/2026-05-24/11291.jsonl"]) });
    await archive(m.deps);
    expect(m.mocks["notifySessionArchived"]).not.toHaveBeenCalled();
  });

  it("a notify failure emits ArchiverNotifyFailures but keeps the run green", async () => {
    const m = consolidatableSession();
    m.mocks["notifySessionArchived"]!.mockRejectedValueOnce(new Error("bus down"));
    const result = await archive(m.deps);
    expect(result.consolidated).toHaveLength(1);
    expect(m.mocks["emitMetric"]).toHaveBeenCalledWith(
      "ArchiverNotifyFailures",
      1,
      expect.objectContaining({ session_id: "11291" }),
    );
  });
});
