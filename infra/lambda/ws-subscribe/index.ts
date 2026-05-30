import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CONN_PK_ATTR,
  CONN_SK_ATTR,
  connMetaSK,
  connPK,
  PK_ATTR,
  PK_PREFIX,
  type ServerMessage,
  sessionPK,
  SubscribeMessageSchema,
  TTL_ATTR,
} from "@f1/shared";
import type { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";

import { handleSubscribe } from "./handler.js";

const CONNECTIONS_TABLE = process.env["CONNECTIONS_TABLE_NAME"];
const LIVE_TABLE = process.env["LIVE_TABLE_NAME"];
if (!CONNECTIONS_TABLE) throw new Error("CONNECTIONS_TABLE_NAME env var not set");
if (!LIVE_TABLE) throw new Error("LIVE_TABLE_NAME env var not set");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Pick the session in F1Live with the most recently written data (max TTL). */
async function resolveActiveSessionId(): Promise<string | null> {
  let token: Record<string, unknown> | undefined;
  let bestPk: string | null = null;
  let bestTtl = -Infinity;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: LIVE_TABLE,
        ProjectionExpression: "#pk, #ttl",
        ExpressionAttributeNames: { "#pk": PK_ATTR, "#ttl": TTL_ATTR },
        ExclusiveStartKey: token,
      }),
    );
    for (const item of res.Items ?? []) {
      const pk = item[PK_ATTR];
      const ttl = typeof item[TTL_ATTR] === "number" ? item[TTL_ATTR] : -Infinity;
      if (typeof pk === "string" && ttl > bestTtl) {
        bestTtl = ttl;
        bestPk = pk;
      }
    }
    token = res.LastEvaluatedKey;
  } while (token);

  if (!bestPk) return null;
  return bestPk.startsWith(`${PK_PREFIX}#`) ? bestPk.slice(PK_PREFIX.length + 1) : bestPk;
}

async function querySession(sessionId: string): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let token: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: LIVE_TABLE,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": PK_ATTR },
        ExpressionAttributeValues: { ":pk": sessionPK(sessionId) },
        ExclusiveStartKey: token,
      }),
    );
    for (const item of res.Items ?? []) items.push(item);
    token = res.LastEvaluatedKey;
  } while (token);
  return items;
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
  const mgmt = new ApiGatewayManagementApiClient({ endpoint });

  const post = async (message: ServerMessage): Promise<void> => {
    await mgmt.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message)),
      }),
    );
  };

  // Validate the inbound message (Constitution VI). Bad input → error frame.
  let session_id: string | undefined;
  try {
    const parsed = SubscribeMessageSchema.parse(JSON.parse(event.body ?? "{}"));
    session_id = parsed.session_id;
  } catch {
    await post({ type: "error", message: "invalid subscribe message" });
    return { statusCode: 400 };
  }

  const result = await handleSubscribe(
    { connectionId, ...(session_id !== undefined ? { session_id } : {}) },
    {
      resolveActiveSessionId,
      setSubscription: async (connId, sessionId) => {
        await ddb.send(
          new UpdateCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { [CONN_PK_ATTR]: connPK(connId), [CONN_SK_ATTR]: connMetaSK() },
            UpdateExpression: "SET session_id = :s",
            ExpressionAttributeValues: { ":s": sessionId },
          }),
        );
      },
      querySession,
      post,
    },
  );

  console.log(JSON.stringify({ level: "info", msg: "ws.subscribe", connectionId, result }));
  return { statusCode: 200 };
};
