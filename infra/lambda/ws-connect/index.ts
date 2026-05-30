import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";

import { handleConnect } from "./handler.js";

const TABLE_NAME = process.env["CONNECTIONS_TABLE_NAME"];
if (!TABLE_NAME) throw new Error("CONNECTIONS_TABLE_NAME env var not set");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;

  await handleConnect(
    { connectionId },
    {
      putConnection: async (Item) => {
        await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item }));
      },
      now: () => new Date(),
    },
  );

  console.log(JSON.stringify({ level: "info", msg: "ws.connect", connectionId }));
  return { statusCode: 200 };
};
