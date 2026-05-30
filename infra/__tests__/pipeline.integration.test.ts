import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PIPELINE_EVENT_SCHEMA_VERSION, type PipelineEvent } from "@f1/shared";
import { afterEach, describe, expect, it } from "vitest";

import { archive, type PartObject } from "../lambda/archiver/handler.js";
import { consumeBatch, type SQSMessage } from "../lambda/consumer/handler.js";
import { pollOnce } from "../lambda/poller/handler.js";

/**
 * End-to-end integration test driving Poller → "SQS" → Consumer → "S3" →
 * Archiver entirely in-memory. Replaces the LocalStack option in the plan
 * with the lighter aws-sdk-client-mock-style pure-mocking approach (also
 * mentioned in the plan as Plan-B).
 *
 * Fixtures come from T3 (`ml/fixtures/openf1/11291`), so this exercises the
 * real OpenF1 response shapes through every stage.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "..", "..", "ml", "fixtures", "openf1", "11291");
const SESSION_KEY = 11291;
const NOW = new Date("2026-05-24T20:30:00.000Z"); // weather tick

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), "utf-8"));
}

// In-memory "AWS" environment ------------------------------------------------
const sqs: { messageId: string; body: string }[] = [];
const ddb = new Map<string, Record<string, unknown>>();
const s3 = new Map<string, string>();

afterEach(() => {
  sqs.length = 0;
  ddb.clear();
  s3.clear();
});

describe("Pipeline integration — fixtures → DDB + S3 part → archive", () => {
  it("flows end-to-end with real OpenF1 fixture shapes", async () => {
    // ── Stage 1: Poller fetches from "OpenF1" (fixture-backed mock) ──────
    const fakeFetch = async (url: string | URL): Promise<Response> => {
      const u = url.toString();
      const endpoint = u.split("/").pop()?.split("?")[0];
      const body = loadFixture(`${endpoint}.json`);
      return new Response(JSON.stringify(body), { status: 200 });
    };

    let messageId = 0;
    const pollerSummary = await pollOnce(
      { session_key: SESSION_KEY },
      {
        fetch: fakeFetch as unknown as typeof globalThis.fetch,
        sendMessage: async (body) => {
          sqs.push({ messageId: `m${++messageId}`, body });
        },
        now: () => NOW,
        sleep: async () => {},
        emitMetric: () => {},
      },
    );

    expect(pollerSummary.succeeded).toBe(5); // weather tick on :30
    expect(sqs).toHaveLength(5);

    // Sanity-check the wire format the Consumer will see.
    const parsed = sqs.map((m) => JSON.parse(m.body) as PipelineEvent);
    for (const env of parsed) {
      expect(env.session_id).toBe(String(SESSION_KEY));
      expect(env.schema_version).toBe(PIPELINE_EVENT_SCHEMA_VERSION);
    }

    // ── Stage 2: Consumer reads the batch, writes "DDB" + "S3" part ──────
    const consumerResult = await consumeBatch(
      { Records: sqs as SQSMessage[] },
      {
        putItems: async (items) => {
          for (const item of items) {
            const pk = item["PK"] as string;
            const sk = item["SK"] as string;
            ddb.set(`${pk}|${sk}`, item);
          }
        },
        putObject: async (key, body) => {
          s3.set(key, body);
        },
        now: () => NOW,
        partSuffix: () => "abcd1234",
        emitMetric: () => {},
      },
    );

    expect(consumerResult.batchItemFailures).toEqual([]);
    expect(consumerResult.archived).toBe(5);
    expect(consumerResult.written).toBeGreaterThan(0);

    // Cross-checks: weather is a singleton, lap items use zero-padded SKs,
    // every item has PK = session#11291.
    expect(ddb.has("session#11291|weather#current")).toBe(true);
    for (const sk of [...ddb.keys()].map((k) => k.split("|")[1]!)) {
      if (sk.startsWith("lap#")) expect(sk).toMatch(/^lap#\d+#\d{4}$/);
    }
    for (const pk of [...ddb.keys()].map((k) => k.split("|")[0]!)) {
      expect(pk).toBe("session#11291");
    }

    // S3 part is one object containing 5 JSONL lines (one per message).
    expect(s3.size).toBe(1);
    const entries = [...s3.entries()];
    const partKey = entries[0]![0];
    const partBody = entries[0]![1];
    expect(partKey).toMatch(/^raw\/sessions\/2026-05-24\/11291\/parts\/.*-abcd1234\.jsonl$/);
    expect(partBody!.split("\n").filter(Boolean)).toHaveLength(5);

    // ── Stage 3: Archiver consolidates the parts (30+ min later) ─────────
    const ARCHIVE_NOW = new Date(NOW.getTime() + 45 * 60 * 1000);
    const partLastModified = NOW;
    const archiveResult = await archive({
      listActiveSessionFolders: async () => [{ date: "2026-05-24", session_id: "11291" }],
      listParts: async (prefix): Promise<PartObject[]> => {
        const out: PartObject[] = [];
        for (const k of s3.keys()) {
          if (k.startsWith(prefix)) {
            out.push({ key: k, lastModified: partLastModified, size: s3.get(k)!.length });
          }
        }
        return out;
      },
      objectExists: async (key) => s3.has(key),
      getObjectText: async (key) => s3.get(key) ?? "",
      putObject: async (key, body) => {
        s3.set(key, body);
      },
      deleteObjects: async (keys) => {
        for (const k of keys) s3.delete(k);
      },
      now: () => ARCHIVE_NOW,
      emitMetric: () => {},
    });

    expect(archiveResult.consolidated).toEqual([
      { date: "2026-05-24", session_id: "11291", rows: 5, parts: 1 },
    ]);
    // Final file present, parts gone.
    expect(s3.has("raw/sessions/2026-05-24/11291.jsonl")).toBe(true);
    expect([...s3.keys()].filter((k) => k.includes("/parts/"))).toHaveLength(0);

    // Final JSONL is chronologically sorted by fetched_at + endpoint.
    const final = s3.get("raw/sessions/2026-05-24/11291.jsonl")!;
    const finalLines = final
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as PipelineEvent);
    for (let i = 1; i < finalLines.length; i++) {
      const prev = finalLines[i - 1]!;
      const next = finalLines[i]!;
      expect(prev.fetched_at <= next.fetched_at).toBe(true);
    }
  });
});
