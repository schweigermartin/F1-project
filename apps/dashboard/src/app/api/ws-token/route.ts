import { mintWsToken } from "@f1/shared/ws-token";
import { NextResponse } from "next/server";

/**
 * Mints a short-lived WebSocket token for the browser. Runs server-side only
 * (it holds WS_TOKEN_SECRET), so node:crypto in @f1/shared/ws-token never
 * reaches the client bundle. The browser fetches this, then opens
 * `${wsUrl}?token=${token}`; the $connect authorizer (T8) verifies it.
 */
export const dynamic = "force-dynamic"; // never cache — tokens expire in 60s

export function GET(): NextResponse {
  const secret = process.env["WS_TOKEN_SECRET"];
  const wsUrl = process.env["NEXT_PUBLIC_WS_URL"];
  if (!secret || !wsUrl) {
    return NextResponse.json({ error: "websocket not configured" }, { status: 503 });
  }
  return NextResponse.json({ token: mintWsToken(secret), wsUrl });
}
