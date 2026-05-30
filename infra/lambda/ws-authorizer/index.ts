import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from "aws-lambda";

import { authorizeConnect } from "./handler.js";

const SSM_PARAM_NAME = process.env["WS_TOKEN_SECRET_PARAM"];
const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (!SSM_PARAM_NAME) throw new Error("WS_TOKEN_SECRET_PARAM env var not set");

const ssm = new SSMClient({});

// Cache the secret across warm invocations (Constitution IV — no GetParameter
// per connect). A rotated secret just expires existing short-lived tokens.
let cachedSecret: string | undefined;
async function getSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const res = await ssm.send(
    new GetParameterCommand({ Name: SSM_PARAM_NAME, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${SSM_PARAM_NAME} has no value`);
  cachedSecret = value;
  return value;
}

function headerCI(
  headers: APIGatewayRequestAuthorizerEvent["headers"],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v ?? undefined;
  }
  return undefined;
}

export async function handler(
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> {
  const origin = headerCI(event.headers, "origin");
  const token = event.queryStringParameters?.["token"];

  const result = authorizeConnect(
    { origin, token },
    { secret: await getSecret(), allowedOrigins: ALLOWED_ORIGINS, now: new Date() },
  );

  console.log(
    JSON.stringify({
      level: "info",
      msg: "ws.authorize",
      allow: result.allow,
      reason: result.reason,
    }),
  );

  // WebSocket authorizers require the IAM-policy response shape (not the
  // simple isAuthorized boolean, which is HTTP-API only).
  return {
    principalId: "ws-client",
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: result.allow ? "Allow" : "Deny",
          Resource: event.methodArn,
        },
      ],
    },
  };
}
