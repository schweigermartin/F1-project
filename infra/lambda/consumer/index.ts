import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import { consumeBatch } from "./handler.js";

const TABLE_NAME = process.env["LIVE_TABLE_NAME"];
const BUCKET_NAME = process.env["DATA_BUCKET_NAME"];
if (!TABLE_NAME) throw new Error("LIVE_TABLE_NAME env var not set");
if (!BUCKET_NAME) throw new Error("DATA_BUCKET_NAME env var not set");

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const s3 = new S3Client({});

/** DDB BatchWriteItem caps at 25 items per request; we chunk and ignore unprocessed for now. */
async function batchWriteAll(items: Array<Record<string, unknown>>): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [TABLE_NAME!]: chunk.map((Item) => ({ PutRequest: { Item } })) },
      }),
    );
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const metrics: Array<{ name: string; value: number; dim?: Record<string, string> }> = [];

  try {
    const result = await consumeBatch(
      { Records: event.Records.map((r) => ({ messageId: r.messageId, body: r.body })) },
      {
        putItems: batchWriteAll,
        putObject: async (Key, Body) => {
          await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key, Body }));
        },
        now: () => new Date(),
        partSuffix: () => randomUUID().slice(0, 8),
        emitMetric: (name, value, dim) => metrics.push({ name, value, dim }),
      },
    );
    console.log(JSON.stringify({ level: "info", msg: "consumer.batch", result, metrics }));
    return { batchItemFailures: result.batchItemFailures };
  } catch (err) {
    const failures: Array<{ itemIdentifier: string }> = Array.isArray(
      (err as { batchItemFailures?: unknown }).batchItemFailures,
    )
      ? (err as { batchItemFailures: Array<{ itemIdentifier: string }> }).batchItemFailures
      : event.Records.map((r) => ({ itemIdentifier: r.messageId }));
    console.error(
      JSON.stringify({
        level: "error",
        msg: "consumer.batch.failed",
        error: err instanceof Error ? err.message : String(err),
        metrics,
        failedIds: failures.map((f) => f.itemIdentifier),
      }),
    );
    return { batchItemFailures: failures };
  }
}
