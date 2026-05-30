import { type DriverState, type ServerMessage, type Weather, WeatherSchema } from "@f1/shared";

type SnapshotWeather = Weather | null;

/**
 * subscribe logic. Pure DI — index.ts wires DDB + the ApiGw management client.
 *
 * Flow:
 *   1. Resolve the target session: the explicit session_id, else the active
 *      one from F1Live (injected resolver).
 *   2. No session → tell the client `no-live-session` (it offers replay).
 *   3. Record connectionId → session_id (so the fanout λ, T5, can find it).
 *   4. Query the session's live items, aggregate them into a per-driver
 *      snapshot + weather, and post it back — chunked if it would blow the
 *      128 KB WebSocket frame cap (R-1).
 *
 * buildSnapshot/buildSnapshotMessages are pure and exported so the
 * aggregation + chunking are unit-tested without any AWS.
 */

/** API Gateway caps a WebSocket frame at 128 KB; stay clear of the edge. */
export const MAX_FRAME_BYTES = 120_000;

export interface SubscribeEvent {
  connectionId: string;
  session_id?: string;
}

export interface SubscribeDeps {
  /** Find the currently active session in F1Live, or null if none. */
  resolveActiveSessionId: () => Promise<string | null>;
  /** Persist connectionId → session_id on the connection row. */
  setSubscription: (connectionId: string, sessionId: string) => Promise<void>;
  /** Query all live items for a session (PK = session#<id>). */
  querySession: (sessionId: string) => Promise<Array<Record<string, unknown>>>;
  /** PostToConnection for this connection. */
  post: (message: ServerMessage) => Promise<void>;
}

export interface SubscribeResult {
  subscribed: boolean;
  session_id: string | null;
  drivers: number;
  frames: number;
}

function emptyDriver(driver_number: number): DriverState {
  return {
    driver_number,
    position: null,
    gap_to_leader: null,
    interval: null,
    compound: null,
    stint_number: null,
    tyre_age: null,
    last_lap_number: null,
    last_lap_duration: null,
  };
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/**
 * Fold the flat F1Live items (one per driver-entity, written by the Consumer
 * as `{ PK, SK, expiresAt, endpoint, ...row }`) into one DriverState per
 * driver + the current weather.
 */
export function buildSnapshot(items: Array<Record<string, unknown>>): {
  drivers: DriverState[];
  weather: SnapshotWeather;
} {
  const byDriver = new Map<number, DriverState>();
  // Track the latest stint/lap number seen per driver so repeated rows resolve
  // to the most recent one.
  const maxStint = new Map<number, number>();
  const maxLap = new Map<number, number>();
  let weather: SnapshotWeather = null;

  const ensure = (dn: number): DriverState => {
    let d = byDriver.get(dn);
    if (!d) {
      d = emptyDriver(dn);
      byDriver.set(dn, d);
    }
    return d;
  };

  for (const item of items) {
    const endpoint = item["endpoint"];
    if (endpoint === "weather") {
      const parsed = WeatherSchema.safeParse(item);
      if (parsed.success) weather = parsed.data;
      continue;
    }

    const dn = asNumber(item["driver_number"]);
    if (dn === null) continue;
    const d = ensure(dn);

    switch (endpoint) {
      case "position":
        d.position = asNumber(item["position"]);
        break;
      case "intervals":
        d.gap_to_leader = (item["gap_to_leader"] ?? null) as DriverState["gap_to_leader"];
        d.interval = (item["interval"] ?? null) as DriverState["interval"];
        break;
      case "stints": {
        const sn = asNumber(item["stint_number"]);
        if (sn !== null && sn >= (maxStint.get(dn) ?? -Infinity)) {
          maxStint.set(dn, sn);
          d.stint_number = sn;
          d.compound = (item["compound"] ?? null) as DriverState["compound"];
          d.tyre_age = asNumber(item["tyre_age_at_start"]);
        }
        break;
      }
      case "laps": {
        const ln = asNumber(item["lap_number"]);
        if (ln !== null && ln >= (maxLap.get(dn) ?? -Infinity)) {
          maxLap.set(dn, ln);
          d.last_lap_number = ln;
          d.last_lap_duration = asNumber(item["lap_duration"]);
        }
        break;
      }
    }
  }

  const drivers = [...byDriver.values()].sort(
    (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity),
  );
  return { drivers, weather };
}

function frameBytes(message: ServerMessage): number {
  return Buffer.byteLength(JSON.stringify(message));
}

/**
 * Split a snapshot into ≤ maxBytes frames. The common case (≤ ~20 drivers,
 * last-lap only) fits in one frame with no `part`. Weather rides the first
 * frame only.
 */
export function buildSnapshotMessages(
  sessionId: string,
  drivers: DriverState[],
  weather: SnapshotWeather,
  maxBytes: number = MAX_FRAME_BYTES,
): ServerMessage[] {
  const single: ServerMessage = {
    type: "snapshot",
    session_id: sessionId,
    drivers,
    weather,
  };
  if (frameBytes(single) <= maxBytes) return [single];

  const frames: DriverState[][] = [[]];
  for (const d of drivers) {
    const cur = frames[frames.length - 1]!;
    cur.push(d);
    const idx = frames.length - 1;
    const probe: ServerMessage = {
      type: "snapshot",
      session_id: sessionId,
      drivers: cur,
      weather: idx === 0 ? weather : null,
      part: { n: idx + 1, of: 99 },
    };
    if (frameBytes(probe) > maxBytes && cur.length > 1) {
      cur.pop();
      frames.push([d]);
    }
  }

  const of = frames.length;
  return frames.map((ds, i) => ({
    type: "snapshot",
    session_id: sessionId,
    drivers: ds,
    weather: i === 0 ? weather : null,
    part: { n: i + 1, of },
  }));
}

export async function handleSubscribe(
  event: SubscribeEvent,
  deps: SubscribeDeps,
): Promise<SubscribeResult> {
  const sessionId = event.session_id ?? (await deps.resolveActiveSessionId());

  if (!sessionId) {
    await deps.post({ type: "info", code: "no-live-session" });
    return { subscribed: false, session_id: null, drivers: 0, frames: 0 };
  }

  await deps.setSubscription(event.connectionId, sessionId);

  const items = await deps.querySession(sessionId);
  const { drivers, weather } = buildSnapshot(items);
  const messages = buildSnapshotMessages(sessionId, drivers, weather);
  for (const message of messages) await deps.post(message);

  return {
    subscribed: true,
    session_id: sessionId,
    drivers: drivers.length,
    frames: messages.length,
  };
}
