import { randomUUID } from "node:crypto";

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  ClientMessageSchema,
  CONN_PK_ATTR,
  CONN_SK_ATTR,
  connMetaSK,
  connPK,
  type ServerMessage,
} from "@f1/shared";
import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";

import { handleReplay } from "./handler.js";

const CONNECTIONS_TABLE = process.env["CONNECTIONS_TABLE_NAME"];
const DATA_BUCKET = process.env["DATA_BUCKET_NAME"];
const WS_CALLBACK_URL = process.env["WS_CALLBACK_URL"];
const SELF_FUNCTION_NAME = process.env["AWS_LAMBDA_FUNCTION_NAME"];
if (!CONNECTIONS_TABLE) throw new Error("CONNECTIONS_TABLE_NAME env var not set");
if (!DATA_BUCKET) throw new Error("DATA_BUCKET_NAME env var not set");
if (!WS_CALLBACK_URL) throw new Error("WS_CALLBACK_URL env var not set");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const lambda = new LambdaClient({});
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_CALLBACK_URL });

/** Async self-invoke continuation payload (a direct Lambda invoke, not a WS event). */
interface Continuation {
  kind: "continuation";
  connectionId: string;
  session_id: string;
  speed: 1 | 2 | 4;
  replayId: string;
  cursor: number;
}

function isContinuation(event: unknown): event is Continuation {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { kind?: unknown }).kind === "continuation"
  );
}

function connKey(connectionId: string): Record<string, string> {
  return { [CONN_PK_ATTR]: connPK(connectionId), [CONN_SK_ATTR]: connMetaSK() };
}

/** Find the archived JSONL for a session (date is in the key, so list + match). */
async function loadLines(sessionId: string): Promise<string[] | null> {
  let token: string | undefined;
  let key: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: DATA_BUCKET,
        Prefix: "raw/sessions/",
        ContinuationToken: token,
      }),
    );
    key = (res.Contents ?? []).map((c) => c.Key).find((k) => k?.endsWith(`/${sessionId}.jsonl`));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (!key && token);

  if (!key) return null;
  const obj = await s3.send(new GetObjectCommand({ Bucket: DATA_BUCKET, Key: key }));
  const body = (await obj.Body?.transformToString()) ?? "";
  return body.split("\n").filter((l) => l.trim().length > 0);
}

async function runReplay(c: Continuation): Promise<void> {
  const metrics: Array<{ name: string; value: number; dim?: Record<string, string> }> = [];

  const result = await handleReplay(
    { session_id: c.session_id, speed: c.speed, cursor: c.cursor },
    {
      loadLines,
      post: async (message: ServerMessage) => {
        try {
          await mgmt.send(
            new PostToConnectionCommand({
              ConnectionId: c.connectionId,
              Data: Buffer.from(JSON.stringify(message)),
            }),
          );
        } catch (err) {
          const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
          if (e?.name === "GoneException" || e?.$metadata?.httpStatusCode === 410) {
            throw { gone: true };
          }
          throw err;
        }
      },
      isAborted: async () => {
        const res = await ddb.send(
          new GetCommand({ TableName: CONNECTIONS_TABLE, Key: connKey(c.connectionId) }),
        );
        const row = res.Item;
        return !row || row["aborted"] === true || row["replayId"] !== c.replayId;
      },
      scheduleContinuation: async (cursor) => {
        const next: Continuation = { ...c, cursor };
        await lambda.send(
          new InvokeCommand({
            FunctionName: SELF_FUNCTION_NAME,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify(next)),
          }),
        );
      },
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      emitMetric: (name, value, dim) => metrics.push({ name, value, dim }),
    },
  );

  console.log(JSON.stringify({ level: "info", msg: "ws.replay", result, metrics }));
}

export async function handler(
  event: APIGatewayProxyWebsocketEventV2 | Continuation,
): Promise<{ statusCode: number } | void> {
  // Async self-invoke → play the next chunk.
  if (isContinuation(event)) {
    await runReplay(event);
    return;
  }

  const connectionId = event.requestContext.connectionId;
  let message;
  try {
    message = ClientMessageSchema.parse(JSON.parse(event.body ?? "{}"));
  } catch {
    return { statusCode: 400 };
  }

  if (message.action === "replay:stop") {
    await ddb.send(
      new UpdateCommand({
        TableName: CONNECTIONS_TABLE,
        Key: connKey(connectionId),
        UpdateExpression: "SET aborted = :t",
        ExpressionAttributeValues: { ":t": true },
      }),
    );
    return { statusCode: 200 };
  }

  if (message.action === "replay:start") {
    const replayId = randomUUID();
    // Reset abort + claim the chain with a fresh replayId. Then hand off to an
    // async invocation so the playback isn't bound by the 29s WS integration
    // timeout (R-3).
    await ddb.send(
      new UpdateCommand({
        TableName: CONNECTIONS_TABLE,
        Key: connKey(connectionId),
        UpdateExpression: "SET aborted = :f, replayId = :r, session_id = :s",
        ExpressionAttributeValues: { ":f": false, ":r": replayId, ":s": message.session_id },
      }),
    );
    await lambda.send(
      new InvokeCommand({
        FunctionName: SELF_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({
            kind: "continuation",
            connectionId,
            session_id: message.session_id,
            speed: message.speed,
            replayId,
            cursor: 0,
          } satisfies Continuation),
        ),
      }),
    );
    return { statusCode: 200 };
  }

  return { statusCode: 400 };
}
