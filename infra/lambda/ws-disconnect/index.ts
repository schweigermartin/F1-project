import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";

import { handleDisconnect } from "./handler.js";

const TABLE_NAME = process.env["CONNECTIONS_TABLE_NAME"];
if (!TABLE_NAME) throw new Error("CONNECTIONS_TABLE_NAME env var not set");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;

  await handleDisconnect(
    { connectionId },
    {
      deleteConnection: async (Key) => {
        await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key }));
      },
    },
  );

  console.log(JSON.stringify({ level: "info", msg: "ws.disconnect", connectionId }));
  return { statusCode: 200 };
};
