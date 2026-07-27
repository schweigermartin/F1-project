"use client";

import { teamColor } from "@f1/shared";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useMemo, useState } from "react";

import {
  defaultActiveDrivers,
  type PitStopRecord,
  type PositionSeries,
  type ProgressionDriver,
} from "../../lib/race-analysis";
import styles from "./progression.module.css";

export interface PositionChartProps {
  series: PositionSeries[];
  drivers: ProgressionDriver[];
  pitStops: PitStopRecord[];
  totalLaps: number;
  /** Three-letter code from the explorer's `?driver=` param, if any. */
  focusCode: string | null;
}

const W = 980;
const H = 470;
const M = { top: 14, right: 52, bottom: 34, left: 30 };
const INNER_W = W - M.left - M.right;
const INNER_H = H - M.top - M.bottom;

/** Label every 5th position, and always the last one, so the axis stays legible. */
function labelledPositions(maxPos: number): number[] {
  const out = [1];
  for (let p = 5; p <= maxPos; p += 5) out.push(p);
  if (!out.includes(maxPos)) out.push(maxPos);
  return out;
}

/** Lap ticks every 5/10 laps depending on race length — never more than ~14. */
function lapTicks(totalLaps: number): number[] {
  const step = totalLaps > 40 ? 10 : 5;
  const out: number[] = [1];
  for (let l = step; l <= totalLaps; l += step) out.push(l);
  return out;
}

/**
 * Position-per-lap trace for a whole race (AC-5). The y-axis is inverted so P1
 * sits on top — the way every timing screen in the sport draws it.
 *
 * Against the 20-line spaghetti problem (spec R-4) only the top ten finishers
 * plus the focused driver are drawn in colour by default; everyone else stays
 * as a faint grey trace and can be switched on individually. Pit stops appear
 * as diamonds on the line, and hovering anywhere gives the full order on that
 * lap.
 */
export function PositionChart({
  series,
  drivers,
  pitStops,
  totalLaps,
  focusCode,
}: PositionChartProps): ReactNode {
  const [active, setActive] = useState<Set<string>>(
    () => new Set(defaultActiveDrivers(drivers, focusCode)),
  );
  const [hoverLap, setHoverLap] = useState<number | null>(null);

  const focusId = useMemo(
    () => drivers.find((d) => d.code === focusCode)?.driverId ?? null,
    [drivers, focusCode],
  );

  const meta = useMemo(() => {
    const map = new Map<string, ProgressionDriver>();
    for (const d of drivers) map.set(d.driverId, d);
    return map;
  }, [drivers]);

  const maxPos = useMemo(
    () => series.reduce((m, s) => s.points.reduce((n, p) => Math.max(n, p.position), m), 1),
    [series],
  );

  const x = useMemo(
    () => scaleLinear<number>({ domain: [1, Math.max(2, totalLaps)], range: [0, INNER_W] }),
    [totalLaps],
  );
  const y = useMemo(
    () => scaleLinear<number>({ domain: [1, maxPos], range: [0, INNER_H] }),
    [maxPos],
  );

  /** driverId → lap → position, for pit markers and the hover read-out. */
  const positionAt = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const s of series) {
      const laps = new Map<number, number>();
      for (const p of s.points) laps.set(p.lap, p.position);
      map.set(s.driverId, laps);
    }
    return map;
  }, [series]);

  const pitsByDriver = useMemo(() => {
    const map = new Map<string, PitStopRecord[]>();
    for (const stop of pitStops) {
      const list = map.get(stop.driverId);
      if (list) list.push(stop);
      else map.set(stop.driverId, [stop]);
    }
    return map;
  }, [pitStops]);

  // Draw inactive traces first, active on top, focused driver last of all.
  const ordered = useMemo(() => {
    const rank = (s: PositionSeries): number =>
      s.driverId === focusId ? 2 : active.has(s.driverId) ? 1 : 0;
    return [...series].sort((a, b) => rank(a) - rank(b));
  }, [series, active, focusId]);

  const hovered = useMemo(() => {
    if (hoverLap === null) return [];
    return [...active]
      .map((driverId) => ({
        driver: meta.get(driverId),
        position: positionAt.get(driverId)?.get(hoverLap),
        pitted: pitsByDriver.get(driverId)?.some((s) => s.lap === hoverLap) ?? false,
      }))
      .filter(
        (r): r is { driver: ProgressionDriver; position: number; pitted: boolean } =>
          r.driver !== undefined && r.position !== undefined,
      )
      .sort((a, b) => a.position - b.position);
  }, [hoverLap, active, meta, positionAt, pitsByDriver]);

  function toggle(driverId: string): void {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(driverId)) next.delete(driverId);
      else next.add(driverId);
      return next;
    });
  }

  function onMove(event: ReactPointerEvent<SVGRectElement>): void {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const ratio = (event.clientX - box.left) / box.width;
    const lap = Math.round(x.invert(ratio * INNER_W));
    setHoverLap(Math.min(totalLaps, Math.max(1, lap)));
  }

  const tooltipLeft = hoverLap === null ? 0 : ((M.left + x(hoverLap)) / W) * 100;

  return (
    <div className={styles.chartWrap}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Positionsverlauf über ${totalLaps} Runden`}
      >
        <Group left={M.left} top={M.top}>
          {labelledPositions(maxPos).map((p) => (
            <Group key={`pos-${p}`}>
              <line className={styles.gridLine} x1={0} x2={INNER_W} y1={y(p)} y2={y(p)} />
              <text className={styles.axisLabel} x={-8} y={y(p)} dy="0.32em" textAnchor="end">
                {p}
              </text>
            </Group>
          ))}
          {lapTicks(totalLaps).map((lap) => (
            <Group key={`lap-${lap}`}>
              <line className={styles.gridLineFaint} x1={x(lap)} x2={x(lap)} y1={0} y2={INNER_H} />
              <text className={styles.axisLabel} x={x(lap)} y={INNER_H + 16} textAnchor="middle">
                {lap}
              </text>
            </Group>
          ))}
          <text className={styles.axisTitle} x={0} y={INNER_H + 30}>
            Runde
          </text>

          {ordered.map((s) => {
            const driver = meta.get(s.driverId);
            const on = active.has(s.driverId);
            const isFocus = s.driverId === focusId;
            const colour = teamColor(driver?.constructor).primary;
            return (
              <LinePath
                key={s.driverId}
                data={s.points}
                x={(p) => x(p.lap)}
                y={(p) => y(p.position)}
                className={(on ? styles.line : styles.lineMuted) ?? ""}
                {...(on ? { stroke: colour, strokeWidth: isFocus ? 3.2 : 2 } : {})}
              />
            );
          })}

          {ordered
            .filter((s) => active.has(s.driverId))
            .map((s) => {
              const colour = teamColor(meta.get(s.driverId)?.constructor).primary;
              return (
                <Group key={`pits-${s.driverId}`}>
                  {(pitsByDriver.get(s.driverId) ?? []).map((stop) => {
                    const pos = positionAt.get(s.driverId)?.get(stop.lap);
                    if (pos === undefined) return null;
                    const cx = x(stop.lap);
                    const cy = y(pos);
                    return (
                      <rect
                        key={stop.stop}
                        className={styles.pitMarker}
                        x={cx - 3.4}
                        y={cy - 3.4}
                        width={6.8}
                        height={6.8}
                        fill={colour}
                        transform={`rotate(45 ${cx} ${cy})`}
                      >
                        <title>{`Boxenstopp · Runde ${stop.lap} · ${stop.duration}s`}</title>
                      </rect>
                    );
                  })}
                </Group>
              );
            })}

          {ordered
            .filter((s) => active.has(s.driverId))
            .map((s) => {
              const driver = meta.get(s.driverId);
              const last = s.points[s.points.length - 1];
              if (!driver || !last) return null;
              return (
                <text
                  key={`label-${s.driverId}`}
                  className={styles.endLabel}
                  x={x(last.lap) + 7}
                  y={y(last.position)}
                  dy="0.32em"
                  fill={teamColor(driver.constructor).primary}
                >
                  {driver.code}
                </text>
              );
            })}

          {hoverLap !== null ? (
            <>
              <line
                className={styles.guide}
                x1={x(hoverLap)}
                x2={x(hoverLap)}
                y1={0}
                y2={INNER_H}
              />
              {hovered.map((r) => (
                <circle
                  key={`hover-${r.driver.driverId}`}
                  className={styles.dot}
                  cx={x(hoverLap)}
                  cy={y(r.position)}
                  r={3.6}
                  fill={teamColor(r.driver.constructor).primary}
                />
              ))}
            </>
          ) : null}

          <rect
            className={styles.hitArea}
            x={0}
            y={0}
            width={INNER_W}
            height={INNER_H}
            onPointerMove={onMove}
            onPointerLeave={() => setHoverLap(null)}
          />
        </Group>
      </svg>

      {hoverLap !== null && hovered.length > 0 ? (
        <div
          className={styles.tooltip}
          style={{ left: `${Math.min(88, Math.max(12, tooltipLeft))}%` }}
        >
          <div className={styles.tooltipHead}>Runde {hoverLap}</div>
          {hovered.map((r) => (
            <div key={r.driver.driverId} className={styles.tooltipRow}>
              <span
                className={styles.tooltipSwatch}
                style={{ background: teamColor(r.driver.constructor).primary }}
                aria-hidden
              />
              <span className={styles.tooltipPos}>P{r.position}</span>
              <span className={styles.tooltipCode}>{r.driver.code}</span>
              {r.pitted ? <span className={styles.tooltipPit}>BOX</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.toggles}>
        {drivers.map((d) => {
          const on = active.has(d.driverId);
          return (
            <button
              key={d.driverId}
              type="button"
              className={[
                styles.toggle,
                on ? styles.toggleOn : "",
                d.driverId === focusId ? styles.toggleFocus : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={on}
              title={`${d.name} · ${d.constructor}`}
              onClick={() => toggle(d.driverId)}
            >
              <span
                className={styles.toggleSwatch}
                style={{ background: teamColor(d.constructor).primary }}
                aria-hidden
              />
              {d.code}
            </button>
          );
        })}
        <span className={styles.toggleActions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => setActive(new Set(drivers.map((d) => d.driverId)))}
          >
            Alle
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => setActive(new Set(defaultActiveDrivers(drivers, focusCode)))}
          >
            Top 10
          </button>
        </span>
      </div>
    </div>
  );
}
