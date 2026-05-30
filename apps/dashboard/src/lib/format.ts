import type { DriverState } from "@f1/shared";

/** Pure presentation helpers — formatting + ordering, tested without a DOM. */

const DASH = "—";

/** Drivers ordered by track position; unknown positions sink to the bottom. */
export function sortedDrivers(drivers: Record<number, DriverState>): DriverState[] {
  return Object.values(drivers).sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
}

/** Gap/interval: numbers as "+s.mmm", lap strings ("+1 LAP") as-is, null as —. */
export function formatGap(value: number | string | null): string {
  if (value === null) return DASH;
  if (typeof value === "string") return value;
  if (value === 0) return "LEADER";
  return `+${value.toFixed(3)}`;
}

/** Lap duration in seconds → "M:SS.mmm" (or "SS.mmm" under a minute). */
export function formatLapTime(seconds: number | null): string {
  if (seconds === null) return DASH;
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const secStr = secs.toFixed(3).padStart(6, "0");
  return mins > 0 ? `${mins}:${secStr}` : secStr.replace(/^0/, "");
}

export interface TyreInfo {
  label: string;
  color: string;
}

const TYRE: Record<string, TyreInfo> = {
  SOFT: { label: "S", color: "#e10600" },
  MEDIUM: { label: "M", color: "#f5c518" },
  HARD: { label: "H", color: "#e6e6e6" },
  INTERMEDIATE: { label: "I", color: "#43b02a" },
  WET: { label: "W", color: "#1e88e5" },
  UNKNOWN: { label: "?", color: "#8a94a6" },
};

export function tyreInfo(compound: string | null): TyreInfo {
  return (compound && TYRE[compound]) || { label: DASH, color: "#8a94a6" };
}

export interface GapBar {
  driver_number: number;
  position: number;
  gapSeconds: number;
  lapped: boolean;
}

/**
 * Bars for the gap chart: drivers with a known position, leader at 0. Lapped
 * drivers (string gap like "+1 LAP") are flagged and pinned to the largest
 * numeric gap so they still render at the far end.
 */
export function gapChartData(drivers: Record<number, DriverState>): GapBar[] {
  const placed = sortedDrivers(drivers).filter(
    (d): d is DriverState & { position: number } => d.position !== null,
  );
  const numericMax = placed.reduce(
    (m, d) => (typeof d.gap_to_leader === "number" ? Math.max(m, d.gap_to_leader) : m),
    0,
  );
  return placed.map((d) => {
    const lapped = typeof d.gap_to_leader === "string";
    const gapSeconds =
      typeof d.gap_to_leader === "number" ? d.gap_to_leader : lapped ? numericMax : 0;
    return { driver_number: d.driver_number, position: d.position, gapSeconds, lapped };
  });
}
