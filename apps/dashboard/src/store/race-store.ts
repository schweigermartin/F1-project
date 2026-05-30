import {
  type DeltaEntity,
  type DriverState,
  type ServerMessage,
  type Weather,
  WeatherSchema,
} from "@f1/shared";
import { create } from "zustand";

/**
 * Normalized live race model, fed by ServerMessages (live or replay — same
 * shapes). Snapshot replaces/merges the driver map; deltas patch one field
 * group per driver. The reducer mirrors the backend buildSnapshot aggregation
 * but applied incrementally.
 */

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";
export type RaceMode = "live" | "replay";

export interface RaceState {
  sessionId: string | null;
  mode: RaceMode;
  connection: ConnectionStatus;
  drivers: Record<number, DriverState>;
  weather: Weather | null;
  /** Set when the server reports no active session (offer replay). */
  noLiveSession: boolean;

  applySnapshot: (msg: Extract<ServerMessage, { type: "snapshot" }>) => void;
  applyDelta: (msg: Extract<ServerMessage, { type: "delta" }>) => void;
  setConnection: (status: ConnectionStatus) => void;
  setMode: (mode: RaceMode) => void;
  setNoLiveSession: (value: boolean) => void;
  reset: () => void;
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

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/** Patch one DriverState from a delta's row, monotonic on lap/stint number. */
export function applyEntity(
  prev: DriverState,
  entity: Exclude<DeltaEntity, "weather">,
  data: Record<string, unknown>,
): DriverState {
  switch (entity) {
    case "position":
      return { ...prev, position: num(data["position"]) };
    case "interval":
      return {
        ...prev,
        gap_to_leader: (data["gap_to_leader"] ?? null) as DriverState["gap_to_leader"],
        interval: (data["interval"] ?? null) as DriverState["interval"],
      };
    case "stint": {
      const sn = num(data["stint_number"]);
      if (sn === null || sn < (prev.stint_number ?? -Infinity)) return prev;
      return {
        ...prev,
        stint_number: sn,
        compound: (data["compound"] ?? null) as DriverState["compound"],
        tyre_age: num(data["tyre_age_at_start"]),
      };
    }
    case "lap": {
      const ln = num(data["lap_number"]);
      if (ln === null || ln < (prev.last_lap_number ?? -Infinity)) return prev;
      return { ...prev, last_lap_number: ln, last_lap_duration: num(data["lap_duration"]) };
    }
  }
}

const initialState = {
  sessionId: null as string | null,
  mode: "live" as RaceMode,
  connection: "closed" as ConnectionStatus,
  drivers: {} as Record<number, DriverState>,
  weather: null as Weather | null,
  noLiveSession: false,
};

export const useRaceStore = create<RaceState>((set) => ({
  ...initialState,

  applySnapshot: (msg) =>
    set((state) => {
      // Merge so chunked snapshot frames (part n/of) accumulate.
      const drivers = { ...state.drivers };
      for (const d of msg.drivers) drivers[d.driver_number] = d;
      return {
        sessionId: msg.session_id,
        drivers,
        noLiveSession: false,
        ...(msg.weather !== null ? { weather: msg.weather } : {}),
      };
    }),

  applyDelta: (msg) =>
    set((state) => {
      if (msg.entity === "weather") {
        const w = WeatherSchema.safeParse(msg.data);
        return w.success ? { weather: w.data } : {};
      }
      const data = (msg.data ?? {}) as Record<string, unknown>;
      const dn = num(data["driver_number"]);
      if (dn === null) return {};
      const prev = state.drivers[dn] ?? emptyDriver(dn);
      return { drivers: { ...state.drivers, [dn]: applyEntity(prev, msg.entity, data) } };
    }),

  setConnection: (connection) => set({ connection }),
  setMode: (mode) => set({ mode }),
  setNoLiveSession: (noLiveSession) => set({ noLiveSession }),
  reset: () => set({ ...initialState, drivers: {} }),
}));
