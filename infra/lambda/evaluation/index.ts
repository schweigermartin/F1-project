import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { evaluateArchivedSession, type EvaluationResult } from "./handler.js";

/**
 * Evaluation lambda adapter — wires real AWS clients + OpenF1 fetch into the
 * pure `evaluateArchivedSession` (same split as every pipeline λ). Invoked by
 * the EventBridge rule on the Archiver's SessionArchived event; for manual
 * re-runs (runbook) it also accepts the bare `{date, session_id}` detail as
 * the whole event payload.
 */

const TABLE_NAME = process.env["PREDICTIONS_TABLE"];
if (!TABLE_NAME) throw new Error("PREDICTIONS_TABLE env var not set");
const BUCKET_NAME = process.env["DATA_BUCKET_NAME"];
if (!BUCKET_NAME) throw new Error("DATA_BUCKET_NAME env var not set");

const OPENF1_BASE = "https://api.openf1.org/v1";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenF1 ${url} → HTTP ${res.status}`);
  return res.json();
}

export async function handler(event: Record<string, unknown>): Promise<{
  ok: boolean;
  result: EvaluationResult;
}> {
  const metrics: Array<{ name: string; value: number; dim?: Record<string, string> }> = [];

  // EventBridge wraps the payload in `detail`; a manual invoke may pass it bare.
  const detail = "detail" in event ? event["detail"] : event;

  const result = await evaluateArchivedSession(detail, {
    fetchSessionByKey: (sessionKey) =>
      fetchJson(`${OPENF1_BASE}/sessions?session_key=${sessionKey}`),
    fetchSeasonRaces: (year) => fetchJson(`${OPENF1_BASE}/sessions?year=${year}&session_name=Race`),
    getArchiveText: async (key) => {
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
      return (await res.Body?.transformToString()) ?? "";
    },
    queryRace: async (pk) => {
      const items: Record<string, unknown>[] = [];
      let cursor: Record<string, unknown> | undefined;
      do {
        const res = await ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": pk },
            ExclusiveStartKey: cursor,
          }),
        );
        items.push(...((res.Items ?? []) as Record<string, unknown>[]));
        cursor = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (cursor);
      return items;
    },
    putItem: async (item) => {
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    },
    now: () => new Date(),
    emitMetric: (name, value, dim) => metrics.push({ name, value, dim }),
  });

  // One EMF blob per invocation: every collected metric becomes a CloudWatch
  // metric under F1/Evaluation without an API call (same EMF mechanism as the
  // inference λ; the pipeline λs predate it and only log their metrics).
  if (metrics.length > 0) {
    console.log(
      JSON.stringify({
        _aws: {
          CloudWatchMetrics: [
            {
              Namespace: "F1/Evaluation",
              Dimensions: [[]],
              Metrics: metrics.map((m) => ({ Name: m.name })),
            },
          ],
          Timestamp: Date.now(),
        },
        ...Object.fromEntries(metrics.map((m) => [m.name, m.value])),
      }),
    );
  }

  console.log(JSON.stringify({ level: "info", msg: "evaluation.run", result, metrics }));
  return { ok: true, result };
}
