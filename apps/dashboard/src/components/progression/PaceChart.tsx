"use client";

import { teamColor } from "@f1/shared";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { type ReactNode, useMemo, useState } from "react";

import {
  formatLapTime,
  type PaceBounds,
  type PacePoint,
  type PaceSeries,
  type ProgressionDriver,
} from "../../lib/race-analysis";
import styles from "./progression.module.css";

export interface PaceChartProps {
  series: PaceSeries[];
  drivers: ProgressionDriver[];
  bounds: PaceBounds;
  outlierCount: number;
  totalLaps: number;
  /** Three-letter code from `?driver=` — preselected as driver A if it raced. */
  focusCode: string | null;
}

const W = 980;
const H = 320;
const M = { top: 14, right: 16, bottom: 34, left: 58 };
const INNER_W = W - M.left - M.right;
const INNER_H = H - M.top - M.bottom;
const NONE = "";

function lapTicks(totalLaps: number): number[] {
  const step = totalLaps > 40 ? 10 : 5;
  const out: number[] = [1];
  for (let l = step; l <= totalLaps; l += step) out.push(l);
  return out;
}

/** Five evenly spaced y ticks across the visible time window. */
function timeTicks(lo: number, hi: number): number[] {
  const n = 4;
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}

/**
 * Lap-time trace for one or two drivers (AC-6). The y-scale is built from clean
 * laps only — a single safety-car lap at +45s would otherwise flatten the whole
 * race into one indistinguishable line. Damped laps are not hidden: they are
 * clamped to the top edge and drawn hollow, so a stop or a caution period stays
 * visible without owning the scale (see `toPaceSeries`, median ± MAD).
 */
export function PaceChart({
  series,
  drivers,
  bounds,
  outlierCount,
  totalLaps,
  focusCode,
}: PaceChartProps): ReactNode {
  const byId = useMemo(() => {
    const map = new Map<string, PaceSeries>();
    for (const s of series) map.set(s.driverId, s);
    return map;
  }, [series]);

  const meta = useMemo(() => {
    const map = new Map<string, ProgressionDriver>();
    for (const d of drivers) map.set(d.driverId, d);
    return map;
  }, [drivers]);

  // Default: the focused driver vs the winner — or the two fastest on average.
  const [defaultA, defaultB] = useMemo(() => {
    const focus = drivers.find((d) => d.code === focusCode && byId.has(d.driverId));
    const ranked = drivers.filter((d) => byId.has(d.driverId));
    const first = focus ?? ranked[0];
    const second = ranked.find((d) => d.driverId !== first?.driverId);
    return [first?.driverId ?? NONE, second?.driverId ?? NONE];
  }, [drivers, byId, focusCode]);

  const [driverA, setDriverA] = useState(defaultA);
  const [driverB, setDriverB] = useState(defaultB);

  const selected = useMemo(
    () =>
      [driverA, driverB]
        .filter((id) => id !== NONE)
        .map((id) => byId.get(id))
        .filter((s): s is PaceSeries => s !== undefined),
    [driverA, driverB, byId],
  );

  const [lo, hi] = useMemo(() => {
    const clean = selected.flatMap((s) => s.points.filter((p) => !p.outlier).map((p) => p.seconds));
    if (clean.length === 0) return [bounds.lower, bounds.upper];
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const pad = Math.max(0.25, (max - min) * 0.08);
    return [min - pad, max + pad];
  }, [selected, bounds]);

  const x = useMemo(
    () => scaleLinear<number>({ domain: [1, Math.max(2, totalLaps)], range: [0, INNER_W] }),
    [totalLaps],
  );
  // Conventional time axis: the fast laps sit low, the slow ones high — which
  // also puts the clamped outliers along the top edge where they read as
  // "off the scale" rather than as competitive laps.
  const y = useMemo(() => scaleLinear<number>({ domain: [lo, hi], range: [INNER_H, 0] }), [lo, hi]);

  const clampY = (p: PacePoint): number => y(Math.min(hi, Math.max(lo, p.seconds)));

  return (
    <div>
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Fahrer A</span>
          <select
            className={styles.select}
            aria-label="Ersten Fahrer für den Pace-Vergleich wählen"
            value={driverA}
            onChange={(e) => setDriverA(e.target.value)}
          >
            <option value={NONE}>— aus —</option>
            {drivers.map((d) => (
              <option key={d.driverId} value={d.driverId} disabled={!byId.has(d.driverId)}>
                {d.code} · {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Fahrer B</span>
          <select
            className={styles.select}
            aria-label="Zweiten Fahrer für den Pace-Vergleich wählen"
            value={driverB}
            onChange={(e) => setDriverB(e.target.value)}
          >
            <option value={NONE}>— aus —</option>
            {drivers.map((d) => (
              <option key={d.driverId} value={d.driverId} disabled={!byId.has(d.driverId)}>
                {d.code} · {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected.length === 0 ? (
        <p className={styles.empty}>Wähle mindestens einen Fahrer für den Pace-Vergleich.</p>
      ) : (
        <div className={styles.chartWrap}>
          <svg
            className={styles.chart}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Rundenzeiten-Vergleich"
          >
            <Group left={M.left} top={M.top}>
              {timeTicks(lo, hi).map((t) => (
                <Group key={`t-${t.toFixed(3)}`}>
                  <line className={styles.gridLineFaint} x1={0} x2={INNER_W} y1={y(t)} y2={y(t)} />
                  <text className={styles.axisLabel} x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                    {formatLapTime(t)}
                  </text>
                </Group>
              ))}
              {lapTicks(totalLaps).map((lap) => (
                <text
                  key={`lap-${lap}`}
                  className={styles.axisLabel}
                  x={x(lap)}
                  y={INNER_H + 16}
                  textAnchor="middle"
                >
                  {lap}
                </text>
              ))}
              <text className={styles.axisTitle} x={0} y={INNER_H + 30}>
                Runde
              </text>

              {selected.map((s) => {
                const colour = teamColor(meta.get(s.driverId)?.constructor).primary;
                return (
                  <Group key={s.driverId}>
                    {s.median !== null ? (
                      <line
                        className={styles.medianLine}
                        x1={0}
                        x2={INNER_W}
                        y1={y(s.median)}
                        y2={y(s.median)}
                        stroke={colour}
                        strokeDasharray="4 4"
                      >
                        <title>{`Median ${meta.get(s.driverId)?.code ?? s.driverId}: ${formatLapTime(s.median)}`}</title>
                      </line>
                    ) : null}
                    <LinePath
                      data={s.points}
                      x={(p) => x(p.lap)}
                      y={clampY}
                      defined={(p) => !p.outlier}
                      className={styles.line ?? ""}
                      stroke={colour}
                      strokeWidth={2}
                    />
                    {s.points.map((p) => (
                      <circle
                        key={p.lap}
                        className={p.outlier ? styles.pointOutlier : styles.point}
                        cx={x(p.lap)}
                        cy={clampY(p)}
                        r={p.outlier ? 3 : 1.9}
                        {...(p.outlier ? { stroke: colour } : { fill: colour })}
                      >
                        <title>
                          {`Runde ${p.lap} · ${formatLapTime(p.seconds)}${
                            p.outlier ? " · gedämpft (Box/SC)" : ""
                          }`}
                        </title>
                      </circle>
                    ))}
                  </Group>
                );
              })}
            </Group>
          </svg>
        </div>
      )}

      <div className={styles.stats}>
        {selected.map((s) => {
          const driver = meta.get(s.driverId);
          const colour = teamColor(driver?.constructor).primary;
          const damped = s.points.filter((p) => p.outlier).length;
          return (
            <div key={s.driverId} className={styles.statBlock}>
              <span className={styles.statSwatch} style={{ background: colour }} aria-hidden />
              <span className={styles.statCode}>{driver?.code ?? s.driverId}</span>
              <span className={styles.statPair}>
                <span className={styles.statVal}>
                  {s.best !== null ? formatLapTime(s.best) : "—"}
                </span>
                <span className={styles.statLabel}>Beste</span>
              </span>
              <span className={styles.statPair}>
                <span className={styles.statVal}>
                  {s.median !== null ? formatLapTime(s.median) : "—"}
                </span>
                <span className={styles.statLabel}>Median</span>
              </span>
              <span className={styles.statPair}>
                <span className={styles.statVal}>{s.points.length - damped}</span>
                <span className={styles.statLabel}>Saubere Runden</span>
              </span>
            </div>
          );
        })}
      </div>

      <p className={styles.note}>
        Skala robust gedämpft (Median ± MAD): {outlierCount} von{" "}
        {series.reduce((n, s) => n + s.points.length, 0)} Runden im Feld liegen außerhalb des Bands
        — Safety-Car-, Box- und Auslaufrunden. Sie werden hohl am Rand gezeichnet statt die Skala zu
        sprengen.
      </p>
    </div>
  );
}
