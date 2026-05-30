import type { ServerMessage } from "@f1/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRaceSocket, type RaceSocketDeps, type WebSocketLike } from "./race-socket.js";

class FakeWS implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.closed = true;
  }
  fireOpen(): void {
    this.onopen?.();
  }
  fireMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
  fireClose(): void {
    this.onclose?.();
  }
}

interface Harness {
  deps: RaceSocketDeps;
  sockets: FakeWS[];
  timers: Array<{ fn: () => void; ms: number }>;
  messages: ServerMessage[];
  statuses: string[];
  invalid: unknown[];
}

function harness(over: Partial<RaceSocketDeps> = {}): Harness {
  const sockets: FakeWS[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const messages: ServerMessage[] = [];
  const statuses: string[] = [];
  const invalid: unknown[] = [];
  const deps: RaceSocketDeps = {
    fetchToken: vi.fn().mockResolvedValue({ token: "tok", wsUrl: "wss://api/live" }),
    createWebSocket: vi.fn(() => {
      const ws = new FakeWS();
      sockets.push(ws);
      return ws;
    }),
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    onInvalid: (r) => invalid.push(r),
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimeoutFn: vi.fn(),
    ...over,
  };
  return { deps, sockets, timers, messages, statuses, invalid };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const SNAPSHOT: ServerMessage = {
  type: "snapshot",
  session_id: "11291",
  drivers: [],
  weather: null,
};

describe("createRaceSocket", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("connects with the token in the URL and subscribes on open", async () => {
    const socket = createRaceSocket(h.deps);
    socket.connect({ action: "subscribe", session_id: "11291" });
    await flush();

    expect(h.deps.createWebSocket).toHaveBeenCalledWith("wss://api/live?token=tok");
    h.sockets[0]!.fireOpen();
    expect(h.statuses).toContain("open");
    expect(JSON.parse(h.sockets[0]!.sent[0]!)).toEqual({
      action: "subscribe",
      session_id: "11291",
    });
  });

  it("forwards a valid ServerMessage and drops an invalid one (AC-6)", async () => {
    const socket = createRaceSocket(h.deps);
    socket.connect({ action: "subscribe" });
    await flush();
    const ws = h.sockets[0]!;
    ws.fireOpen();

    ws.fireMessage(JSON.stringify(SNAPSHOT));
    ws.fireMessage("{ not json");
    ws.fireMessage(JSON.stringify({ type: "bogus" }));

    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]!.type).toBe("snapshot");
    expect(h.invalid).toHaveLength(2);
  });

  it("reconnects after a drop and re-subscribes, with backoff < 5s (AC-4)", async () => {
    const socket = createRaceSocket(h.deps);
    socket.connect({ action: "subscribe", session_id: "11291" });
    await flush();
    h.sockets[0]!.fireOpen();
    h.sockets[0]!.fireClose();

    expect(h.statuses).toContain("reconnecting");
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBeLessThan(5000);

    h.timers[0]!.fn(); // fire the reconnect timer
    await flush();
    expect(h.sockets).toHaveLength(2); // a new socket was opened

    h.sockets[1]!.fireOpen();
    expect(JSON.parse(h.sockets[1]!.sent[0]!)).toEqual({
      action: "subscribe",
      session_id: "11291",
    });
  });

  it("grows backoff exponentially and caps it on repeated connect failures", async () => {
    const h2 = harness({ fetchToken: vi.fn().mockRejectedValue(new Error("no token")) });
    const socket = createRaceSocket({ ...h2.deps, maxBackoffMs: 3000 });
    socket.connect({ action: "subscribe" });
    await flush();

    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = h2.timers[h2.timers.length - 1]!;
      delays.push(t.ms);
      t.fn();
      await flush();
    }
    expect(delays).toEqual([250, 500, 1000, 2000, 3000, 3000]);
  });

  it("does not reconnect after close()", async () => {
    const socket = createRaceSocket(h.deps);
    socket.connect({ action: "subscribe" });
    await flush();
    h.sockets[0]!.fireOpen();
    socket.close();
    h.sockets[0]!.fireClose();
    expect(h.timers).toHaveLength(0);
    expect(h.statuses.at(-1)).toBe("closed");
  });
});
