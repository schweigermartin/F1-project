/**
 * Pure race-progression maths (Phase 9, plan §3.1). No fetch, no React — the
 * fetching lives in `race-progression.ts`, the drawing in
 * `components/progression/*`. Everything here is deterministic and unit-tested;
 * it is the correctness core of the race-analysis panel (AC-5/AC-6).
 */

import type { RaceResultRow } from "./f1-api";

/** One driver on one lap, flattened out of Jolpica's per-lap grouping. */
export interface LapRecord {
  lap: number;
  driverId: string;
  position: number;
  /** Raw Jolpica lap time, e.g. `"1:29.421"`. */
  time: string;
}

export interface PitStopRecord {
  driverId: string;
  /** The lap the car came in on — the stint ends here. */
  lap: number;
  stop: number;
  /** Raw duration string, e.g. `"21.789"`. */
  duration: string;
}

// ─── Lap-time parsing ────────────────────────────────────────────────────

/**
 * `"1:29.421"` → `89.421`. Also accepts `"29.421"` (sub-minute) and
 * `"1:02:03.456"` (the hour form Ergast uses for cumulative times). Anything
 * else — empty, `"—"`, a stray unit — is `null` rather than `NaN`, so a single
 * odd record can never poison a scale.
 */
export function parseLapTime(raw: string): number | null {
  const parts = raw.trim().split(":");
  if (parts.length === 0 || parts.length > 3) return null;

  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    // Only the last component may carry a fraction; the others are integers.
    const isLast = i === parts.length - 1;
    const ok = isLast ? /^\d+(\.\d+)?$/.test(part) : /^\d+$/.test(part);
    if (!ok) return null;
    seconds = seconds * 60 + Number(part);
  }
  return seconds > 0 ? seconds : null;
}

/** `89.421` → `"1:29.421"`; below a minute → `"29.421"`. Inverse of the above. */
export function formatLapTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, "0");
  return m > 0 ? `${m}:${s}` : s;
}

// ─── Position series (AC-5) ──────────────────────────────────────────────

export interface PositionPoint {
  lap: number;
  position: number;
}

export interface PositionSeries {
  driverId: string;
  points: PositionPoint[];
  /** Position on the driver's last recorded lap — retirements sort last. */
  finalPosition: number;
  /** Last lap the driver completed (< race distance if they retired). */
  lastLap: number;
}

/**
 * Per-driver position trace, laps ascending. Drivers are ordered by their last
 * known position, and — because a retirement leaves a driver classified but not
 * running — by laps completed first, so the leader board reads top-down.
 */
export function toPositionSeries(laps: readonly LapRecord[]): PositionSeries[] {
  const byDriver = new Map<string, PositionPoint[]>();
  for (const rec of laps) {
    const points = byDriver.get(rec.driverId);
    if (points) points.push({ lap: rec.lap, position: rec.position });
    else byDriver.set(rec.driverId, [{ lap: rec.lap, position: rec.position }]);
  }

  const series: PositionSeries[] = [];
  for (const [driverId, points] of byDriver) {
    points.sort((a, b) => a.lap - b.lap);
    const last = points[points.length - 1];
    if (!last) continue;
    series.push({ driverId, points, finalPosition: last.position, lastLap: last.lap });
  }

  return series.sort((a, b) => b.lastLap - a.lastLap || a.finalPosition - b.finalPosition);
}

// ─── Pace series with robust outlier damping (AC-6) ──────────────────────

export interface PacePoint {
  lap: number;
  seconds: number;
  /** Outside the robust band — a safety car, an in-lap or a spin. */
  outlier: boolean;
}

export interface PaceSeries {
  driverId: string;
  points: PacePoint[];
  /** Median of this driver's clean laps, `null` if they have none. */
  median: number | null;
  /** Fastest clean lap, `null` if they have none. */
  best: number | null;
}

export interface PaceBounds {
  /** Median across every lap in the input — the centre of the robust band. */
  median: number;
  /** Median absolute deviation (raw, unscaled). */
  mad: number;
  lower: number;
  upper: number;
}

export interface PaceChartData {
  series: PaceSeries[];
  bounds: PaceBounds;
  /** How many laps fall outside the band — shown as a footnote in the UI. */
  outlierCount: number;
}

/** Median of a non-empty numeric array. Copies before sorting (no mutation). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? NaN;
  return ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
}

/** Consistency constant making MAD comparable to a standard deviation. */
const MAD_TO_SIGMA = 1.4826;
/** Fallback band width when every lap is identical (MAD = 0): ±1% of median. */
const DEGENERATE_BAND = 0.01;

/**
 * Lap times per driver, in seconds, with a robust band around the field median.
 *
 * Mean ± stddev is useless here: two safety-car laps at +40s drag the mean up
 * and inflate the deviation until every real lap looks "normal" and the y-scale
 * spans a minute. Median ± k·(1.4826·MAD) ignores them by construction — the
 * band is set by the middle of the distribution, so the chart can clamp the
 * outliers to the edge and keep a readable scale (spec AC-6).
 */
export function toPaceSeries(
  laps: readonly LapRecord[],
  options: { madFactor?: number; driverIds?: readonly string[] } = {},
): PaceChartData {
  const madFactor = options.madFactor ?? 3;
  const wanted = options.driverIds ? new Set(options.driverIds) : null;

  const byDriver = new Map<string, PacePoint[]>();
  const all: number[] = [];
  for (const rec of laps) {
    if (wanted && !wanted.has(rec.driverId)) continue;
    const seconds = parseLapTime(rec.time);
    if (seconds === null) continue;
    all.push(seconds);
    const points = byDriver.get(rec.driverId);
    const point: PacePoint = { lap: rec.lap, seconds, outlier: false };
    if (points) points.push(point);
    else byDriver.set(rec.driverId, [point]);
  }

  if (all.length === 0) {
    return {
      series: [],
      bounds: { median: 0, mad: 0, lower: 0, upper: 0 },
      outlierCount: 0,
    };
  }

  const med = median(all);
  const mad = median(all.map((v) => Math.abs(v - med)));
  const spread = mad > 0 ? MAD_TO_SIGMA * mad * madFactor : med * DEGENERATE_BAND;
  const bounds: PaceBounds = {
    median: med,
    mad,
    lower: Math.max(0, med - spread),
    upper: med + spread,
  };

  let outlierCount = 0;
  const series: PaceSeries[] = [];
  for (const [driverId, points] of byDriver) {
    points.sort((a, b) => a.lap - b.lap);
    const clean: number[] = [];
    for (const p of points) {
      p.outlier = p.seconds > bounds.upper || p.seconds < bounds.lower;
      if (p.outlier) outlierCount++;
      else clean.push(p.seconds);
    }
    series.push({
      driverId,
      points,
      median: clean.length > 0 ? median(clean) : null,
      best: clean.length > 0 ? Math.min(...clean) : null,
    });
  }

  series.sort((a, b) => (a.median ?? Infinity) - (b.median ?? Infinity));
  return { series, bounds, outlierCount };
}

// ─── Stints (AC-6) ───────────────────────────────────────────────────────

export interface Stint {
  /** 1-based. */
  number: number;
  startLap: number;
  endLap: number;
  laps: number;
  /** Duration of the stop that ENDED this stint; `null` for the final stint. */
  pitDuration: string | null;
}

export interface DriverStints {
  driverId: string;
  stints: Stint[];
  lastLap: number;
}

/**
 * Stint segments per driver, derived from the pit-stop laps. Jolpica reports a
 * stop on the lap the car came in on, so stint _n_ runs from the previous stop's
 * lap + 1 up to and including this stop's lap; the final stint runs to the
 * driver's last completed lap.
 *
 * Stops after a driver's last lap (a retirement in the pits) are dropped, and
 * duplicate stops on one lap collapse — both produce zero-length segments that
 * would render as invisible slivers.
 */
export function toStints(
  laps: readonly LapRecord[],
  pitStops: readonly PitStopRecord[],
): DriverStints[] {
  const lastLap = new Map<string, number>();
  for (const rec of laps) {
    const seen = lastLap.get(rec.driverId);
    if (seen === undefined || rec.lap > seen) lastLap.set(rec.driverId, rec.lap);
  }

  const stopsByDriver = new Map<string, PitStopRecord[]>();
  for (const stop of pitStops) {
    const list = stopsByDriver.get(stop.driverId);
    if (list) list.push(stop);
    else stopsByDriver.set(stop.driverId, [stop]);
  }

  const out: DriverStints[] = [];
  for (const [driverId, finalLap] of lastLap) {
    const stops = (stopsByDriver.get(driverId) ?? [])
      .filter((s) => s.lap >= 1 && s.lap < finalLap)
      .sort((a, b) => a.lap - b.lap);

    const stints: Stint[] = [];
    let start = 1;
    for (const stop of stops) {
      if (stop.lap < start) continue; // duplicate/out-of-order stop on the same lap
      stints.push({
        number: stints.length + 1,
        startLap: start,
        endLap: stop.lap,
        laps: stop.lap - start + 1,
        pitDuration: stop.duration,
      });
      start = stop.lap + 1;
    }
    if (start <= finalLap) {
      stints.push({
        number: stints.length + 1,
        startLap: start,
        endLap: finalLap,
        laps: finalLap - start + 1,
        pitDuration: null,
      });
    }
    if (stints.length > 0) out.push({ driverId, stints, lastLap: finalLap });
  }

  return out.sort((a, b) => b.lastLap - a.lastLap || a.driverId.localeCompare(b.driverId));
}

// ─── Driver identity ─────────────────────────────────────────────────────

export interface ProgressionDriver {
  driverId: string;
  /** Three-letter code — the same key the `?driver=` focus param uses. */
  code: string;
  name: string;
  constructor: string;
  /** Classified finishing position, `null` if the results are unavailable. */
  finishPosition: number | null;
}

/** `"max_verstappen"` → `"Max Verstappen"`. Last-resort label, never throws. */
function prettifyDriverId(driverId: string): string {
  return driverId
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Join the lap records' `driverId` against the Jolpica classification to get a
 * code, a display name and a team (for the colour). If the results are missing
 * we still render: the code falls back to the surname's first three letters,
 * which is what the real code is in the overwhelming majority of cases.
 */
export function buildProgressionDrivers(
  laps: readonly LapRecord[],
  results: readonly RaceResultRow[] | null,
): ProgressionDriver[] {
  const byId = new Map<string, RaceResultRow>();
  for (const row of results ?? []) if (row.driverId) byId.set(row.driverId, row);

  const seen = new Set<string>();
  const drivers: ProgressionDriver[] = [];
  for (const rec of laps) {
    if (seen.has(rec.driverId)) continue;
    seen.add(rec.driverId);
    const row = byId.get(rec.driverId);
    const surname = rec.driverId.split("_").pop() ?? rec.driverId;
    drivers.push({
      driverId: rec.driverId,
      code: row?.code ?? surname.slice(0, 3).toUpperCase(),
      name: row?.driver ?? prettifyDriverId(rec.driverId),
      constructor: row?.constructor ?? "—",
      finishPosition: row ? row.position : null,
    });
  }

  // Classified drivers first (by result), unclassified appended alphabetically.
  return drivers.sort(
    (a, b) =>
      (a.finishPosition ?? Infinity) - (b.finishPosition ?? Infinity) ||
      a.code.localeCompare(b.code),
  );
}

/**
 * Which drivers a 20-line chart shows by default (spec R-4): the top `count`
 * finishers plus the focused driver, who is always included even from P18.
 */
export function defaultActiveDrivers(
  drivers: readonly ProgressionDriver[],
  focusCode: string | null,
  count = 10,
): string[] {
  const active = drivers.slice(0, count).map((d) => d.driverId);
  const focus = focusCode ? drivers.find((d) => d.code === focusCode) : undefined;
  if (focus && !active.includes(focus.driverId)) active.push(focus.driverId);
  return active;
}
