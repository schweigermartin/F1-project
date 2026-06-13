"use client";

import { type ReactNode, useEffect, useState } from "react";

import { type ActualSlot, diffPredictionVsActual, hitCount } from "../../lib/live-diff";
import { getLivePositions } from "../../lib/openf1-weekend";
import styles from "../hub.module.css";

const POLL_MS = 15_000; // Constitution IV: modest interval, only while live.

export interface LiveResultPanelProps {
  predictedTop3: string[]; // driver codes
  /** Map OpenF1 driver_number → code (from the predictions). */
  numberToCode: Record<number, string>;
  /** Final result top-3 (Jolpica) when there is no live session. */
  finalTop3: ActualSlot[] | null;
  /** OpenF1 session_key of the currently-active race session, else null. */
  liveSessionKey: number | null;
}

/**
 * Live positions (OpenF1, polled only while a race session is active) or the
 * final result, each diffed against the predicted podium (AC-8). Top-3 hits are
 * green, misses red.
 */
export function LiveResultPanel({
  predictedTop3,
  numberToCode,
  finalTop3,
  liveSessionKey,
}: LiveResultPanelProps): ReactNode {
  const [liveTop3, setLiveTop3] = useState<ActualSlot[] | null>(null);

  useEffect(() => {
    if (liveSessionKey === null) return;
    let active = true;
    const poll = async (): Promise<void> => {
      const positions = await getLivePositions(liveSessionKey);
      if (!active || positions.length === 0) return;
      setLiveTop3(
        positions.slice(0, 3).map((p) => ({
          position: p.position,
          code: numberToCode[p.driver_number] ?? null,
          driverNumber: p.driver_number,
        })),
      );
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [liveSessionKey, numberToCode]);

  const isLive = liveSessionKey !== null && liveTop3 !== null;
  const actual = isLive ? liveTop3 : finalTop3;
  if (!actual || actual.length === 0 || predictedTop3.length === 0) return null;

  const rows = diffPredictionVsActual(predictedTop3, actual);
  const hits = hitCount(rows);

  return (
    <section className={`card ${styles.col8}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Vorhersage vs. Realität</h2>
        {isLive ? (
          <span className={styles.liveBadge}>● live</span>
        ) : (
          <span className={styles.panelMeta}>Endergebnis · {hits}/3 getroffen</span>
        )}
      </div>
      <div className={styles.podium}>
        {rows.map((r) => (
          <div
            key={r.position}
            className={`${styles.resultRow} ${r.hit ? styles.hit : styles.miss}`}
          >
            <span className="tnum" style={{ fontWeight: 700 }}>
              P{r.position}
            </span>
            <span style={{ fontWeight: 600 }}>{r.code ?? `#${r.driverNumber ?? "?"}`}</span>
            <span className={styles.panelMeta}>{r.hit ? "vorhergesagt ✓" : "verpasst"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
