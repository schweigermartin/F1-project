"use client";

import type { ReplaySpeed } from "@f1/shared";
import { useEffect, useRef } from "react";

import { createRaceSocket, type RaceSocket, type WebSocketLike } from "../lib/race-socket";
import { useRaceStore } from "../store/race-store";

/** Adapt a browser WebSocket to the controller's WebSocketLike interface. */
function browserWebSocket(url: string): WebSocketLike {
  const ws = new WebSocket(url);
  const like: WebSocketLike = {
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => like.onopen?.();
  ws.onmessage = (ev: MessageEvent) => like.onmessage?.({ data: ev.data });
  ws.onclose = () => like.onclose?.();
  ws.onerror = () => like.onerror?.();
  return like;
}

export interface RaceSocketControls {
  startReplay: (sessionId: string, speed: ReplaySpeed) => void;
  stopReplay: () => void;
}

/**
 * Opens the live WebSocket on mount, pipes validated ServerMessages into the
 * race store, and exposes replay controls (used by T12). Reconnect/backoff and
 * re-subscribe live in the controller.
 */
export function useRaceSocket(): RaceSocketControls {
  const ref = useRef<RaceSocket | null>(null);

  useEffect(() => {
    const store = useRaceStore.getState();
    const socket = createRaceSocket({
      fetchToken: async () => {
        const res = await fetch("/api/ws-token");
        if (!res.ok) throw new Error(`ws-token ${res.status}`);
        return res.json() as Promise<{ token: string; wsUrl: string }>;
      },
      createWebSocket: browserWebSocket,
      onStatus: (status) => store.setConnection(status),
      onInvalid: (raw) => console.warn("dropping invalid ws message", raw),
      onMessage: (msg) => {
        switch (msg.type) {
          case "snapshot":
            store.applySnapshot(msg);
            break;
          case "delta":
            store.applyDelta(msg);
            break;
          case "info":
            if (msg.code === "no-live-session") store.setNoLiveSession(true);
            break;
          case "replay:end":
            store.setMode("live");
            break;
          case "error":
            console.warn("ws error frame", msg.message);
            break;
        }
      },
    });
    ref.current = socket;
    socket.connect({ action: "subscribe" });
    return () => socket.close();
  }, []);

  return {
    startReplay: (sessionId, speed) => {
      useRaceStore.getState().setMode("replay");
      ref.current?.send({ action: "replay:start", session_id: sessionId, speed });
    },
    stopReplay: () => {
      ref.current?.send({ action: "replay:stop" });
      useRaceStore.getState().setMode("live");
    },
  };
}
