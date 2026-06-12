import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { PK_ATTR } from "@f1/shared";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

import {
  getRacePredictions,
  getSeasonEvaluations,
  InvalidQueryError,
  RaceNotFoundError,
} from "./handler.js";

const PREDICTIONS_TABLE = process.env["PREDICTIONS_TABLE"];
if (!PREDICTIONS_TABLE) throw new Error("PREDICTIONS_TABLE env var not set");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Page through every item under one race partition. A race is ~20 drivers ×
 * 2 rows = ~40 items, so this is almost always a single page. */
async function queryRace(pk: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let token: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: PREDICTIONS_TABLE,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": PK_ATTR },
        ExpressionAttributeValues: { ":pk": pk },
        ExclusiveStartKey: token,
      }),
    );
    for (const item of res.Items ?? []) items.push(item);
    token = res.LastEvaluatedKey;
  } while (token);
  return items;
}

function json(
  statusCode: number,
  body: unknown,
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode,
    // CORS is enforced by the Function URL config (scoped origins, never `*`);
    // here we only declare the content type and a short browser cache.
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const query = event.queryStringParameters ?? null;
    // Two modes on one URL: `?season=<year>` (Phase 5 chart) vs the original
    // `?race_date=&round=` (Phase 4 predictions). Routed here, logic in handler.ts.
    const response =
      query && query["season"] !== undefined
        ? await getSeasonEvaluations(query, { queryRace })
        : await getRacePredictions(query, { queryRace });
    return json(200, response);
  } catch (err) {
    if (err instanceof InvalidQueryError) return json(400, { error: err.message });
    if (err instanceof RaceNotFoundError) return json(404, { error: err.message });
    console.error(
      JSON.stringify({ level: "error", msg: "predictions-api.failure", err: `${err}` }),
    );
    return json(500, { error: "internal error" });
  }
};
