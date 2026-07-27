import { teamColor } from "@f1/shared";
import type { ReactNode } from "react";

import type { DriverStints, ProgressionDriver } from "../../lib/race-analysis";
import styles from "./progression.module.css";

export interface StintBarProps {
  stints: DriverStints[];
  drivers: ProgressionDriver[];
  totalLaps: number;
  focusCode: string | null;
}

/** Only label a segment that is wide enough to hold the text without clipping. */
const LABEL_MIN_LAPS = 6;

/**
 * One horizontal bar per driver, split at the pit-stop laps (AC-6). Segment
 * width is proportional to stint length, so a one-stopper and a three-stopper
 * are distinguishable at a glance — the whole point of the panel (US-3).
 *
 * Compounds would need OpenF1's `/stints`, which has no coverage for the races
 * before the Phase-9 ingest; the stints alternate between the team's two brand
 * shades instead, which keeps the row readable without inventing tyre data.
 */
export function StintBar({ stints, drivers, totalLaps, focusCode }: StintBarProps): ReactNode {
  const meta = new Map(drivers.map((d) => [d.driverId, d]));
  const ordered = [...stints].sort((a, b) => {
    const pa = meta.get(a.driverId)?.finishPosition ?? Infinity;
    const pb = meta.get(b.driverId)?.finishPosition ?? Infinity;
    return pa - pb || b.lastLap - a.lastLap;
  });

  const ticks = [1, Math.round(totalLaps / 2), totalLaps];

  return (
    <div>
      <div className={styles.stintRuler} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className={styles.stintTick}>
            L{t}
          </span>
        ))}
      </div>

      <div className={styles.stints}>
        {ordered.map((row) => {
          const driver = meta.get(row.driverId);
          const colours = teamColor(driver?.constructor);
          const isFocus = driver?.code === focusCode && focusCode !== null;
          return (
            <div
              key={row.driverId}
              className={`${styles.stintRow} ${isFocus ? styles.stintRowFocus : ""}`}
            >
              <span className={styles.stintCode}>{driver?.code ?? row.driverId}</span>
              <span
                className={styles.stintTrack}
                role="img"
                aria-label={`${driver?.code ?? row.driverId}: ${row.stints.length} Stints über ${row.lastLap} Runden`}
              >
                {row.stints.map((stint) => (
                  <span
                    key={stint.number}
                    className={styles.stintSeg}
                    style={{
                      flexGrow: stint.laps,
                      // Alternating brand shades — a stint boundary must read
                      // as a boundary even without a gap between segments.
                      background: stint.number % 2 === 1 ? colours.primary : colours.accent,
                    }}
                    title={
                      `Stint ${stint.number}: Runde ${stint.startLap}–${stint.endLap} (${stint.laps} Runden)` +
                      (stint.pitDuration ? ` · Stopp ${stint.pitDuration}s` : "")
                    }
                  >
                    {stint.laps >= LABEL_MIN_LAPS ? stint.laps : ""}
                  </span>
                ))}
                {/* Retirements leave the rest of the distance empty. */}
                {row.lastLap < totalLaps ? (
                  <span style={{ flexGrow: totalLaps - row.lastLap }} aria-hidden />
                ) : null}
              </span>
              <span className={styles.stintCount}>
                {row.stints.length - 1}
                <span aria-hidden>×</span>
              </span>
            </div>
          );
        })}
      </div>

      <p className={styles.note}>
        Segmentbreite = Runden im Stint, Zahl = Rundenzahl; die Spalte rechts zählt die Boxenstopps.
        Ein verkürzter Balken bedeutet Ausfall. Quelle: Jolpica-Boxenstopps.
      </p>
    </div>
  );
}
