import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { CONN_PK_ATTR, CONN_SK_ATTR, connMetaSK, connPK, type ServerMessage } from "@f1/shared";
import type { DynamoDBStreamEvent } from "aws-lambda";

import { fanout, type FanoutRecord } from "./handler.js";

const CONNECTIONS_TABLE = process.env["CONNECTIONS_TABLE_NAME"];
const WS_CALLBACK_URL = process.env["WS_CALLBACK_URL"];
if (!CONNECTIONS_TABLE) throw new Error("CONNECTIONS_TABLE_NAME env var not set");
if (!WS_CALLBACK_URL) throw new Error("WS_CALLBACK_URL env var not set");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_CALLBACK_URL });

/** Subscribers of a session: scan the connections table by session_id. */
async function listConnections(sessionId: string): Promise<string[]> {
  const ids: string[] = [];
  let token: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: CONNECTIONS_TABLE,
        FilterExpression: "session_id = :s",
        ExpressionAttributeValues: { ":s": sessionId },
        ProjectionExpression: "connectionId",
        ExclusiveStartKey: token,
      }),
    );
    for (const item of res.Items ?? []) {
      if (typeof item["connectionId"] === "string") ids.push(item["connectionId"]);
    }
    token = res.LastEvaluatedKey;
  } while (token);
  return ids;
}

function isGoneError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "GoneException" || e?.$metadata?.httpStatusCode === 410;
}

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const metrics: Array<{ name: string; value: number; dim?: Record<string, string> }> = [];

  const records: FanoutRecord[] = event.Records.map((r) => ({
    eventName: (r.eventName ?? "MODIFY") as FanoutRecord["eventName"],
    ...(r.dynamodb?.NewImage ? { newImage: unmarshall(r.dynamodb.NewImage as never) } : {}),
  }));

  const result = await fanout(
    { Records: records },
    {
      listConnections,
      post: async (connectionId, message: ServerMessage) => {
        try {
          await mgmt.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: Buffer.from(JSON.stringify(message)),
            }),
          );
        } catch (err) {
          if (isGoneError(err)) throw { gone: true };
          throw err;
        }
      },
      deleteConnection: async (connectionId) => {
        await ddb.send(
          new DeleteCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { [CONN_PK_ATTR]: connPK(connectionId), [CONN_SK_ATTR]: connMetaSK() },
          }),
        );
      },
      emitMetric: (name, value, dim) => metrics.push({ name, value, dim }),
    },
  );

  console.log(JSON.stringify({ level: "info", msg: "ws.fanout", result, metrics }));
}
