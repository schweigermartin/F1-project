import { type ClientMessage, type ServerMessage, ServerMessageSchema } from "@f1/shared";

import type { ConnectionStatus } from "../store/race-store";

/**
 * WebSocket lifecycle controller — pure DI so it's testable without a DOM or
 * a real socket. The React hook (use-race-socket) wires real deps; tests
 * inject a fake WebSocket + a captured timer.
 *
 * Responsibilities:
 *   - fetch a fresh token, connect, (re-)send the subscribe/replay intent on
 *     open so a reconnect transparently restores state (AC-4).
 *   - validate every inbound frame against ServerMessageSchema; drop + report
 *     anything invalid, never feed it to the store (AC-6).
 *   - reconnect with capped exponential backoff that always lands well under
 *     the 5s budget (AC-4).
 */

const BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 3000; // < 5s reconnect budget (AC-4)

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface RaceSocketDeps {
  fetchToken: () => Promise<{ token: string; wsUrl: string }>;
  createWebSocket: (url: string) => WebSocketLike;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  onInvalid?: (raw: unknown) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  maxBackoffMs?: number;
}

export interface RaceSocket {
  connect: (intent: ClientMessage) => void;
  send: (msg: ClientMessage) => void;
  close: () => void;
}

export function createRaceSocket(deps: RaceSocketDeps): RaceSocket {
  const setTimeoutFn = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn =
    deps.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const maxBackoff = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let ws: WebSocketLike | null = null;
  let intent: ClientMessage = { action: "subscribe" };
  let attempt = 0;
  let open = false;
  let stopped = false;
  let timer: unknown = null;

  function handleRaw(data: unknown): void {
    let json: unknown;
    try {
      json = JSON.parse(String(data));
    } catch {
      deps.onInvalid?.(data);
      return;
    }
    const parsed = ServerMessageSchema.safeParse(json);
    if (!parsed.success) {
      deps.onInvalid?.(json);
      return;
    }
    deps.onMessage(parsed.data);
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    deps.onStatus("reconnecting");
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, maxBackoff);
    attempt += 1;
    timer = setTimeoutFn(start, delay);
  }

  async function start(): Promise<void> {
    if (stopped) return;
    deps.onStatus(attempt === 0 ? "connecting" : "reconnecting");

    let token: string;
    let wsUrl: string;
    try {
      ({ token, wsUrl } = await deps.fetchToken());
    } catch {
      scheduleReconnect();
      return;
    }
    if (stopped) return;

    const socket = deps.createWebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
    ws = socket;
    socket.onopen = () => {
      attempt = 0;
      open = true;
      deps.onStatus("open");
      socket.send(JSON.stringify(intent));
    };
    socket.onmessage = (ev) => handleRaw(ev.data);
    socket.onclose = () => {
      open = false;
      if (!stopped) scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* close() may throw on an already-dead socket */
      }
    };
  }

  return {
    connect: (next) => {
      intent = next;
      stopped = false;
      void start();
    },
    send: (msg) => {
      // Remember the latest subscribe/replayStart so a reconnect restores it.
      if (msg.action === "subscribe" || msg.action === "replayStart") intent = msg;
      if (open && ws) ws.send(JSON.stringify(msg));
    },
    close: () => {
      stopped = true;
      if (timer !== null) clearTimeoutFn(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      deps.onStatus("closed");
    },
  };
}
