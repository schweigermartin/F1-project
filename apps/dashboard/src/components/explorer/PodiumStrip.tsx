import { teamColor } from "@f1/shared";
import type { ReactNode } from "react";

import styles from "./explorer.module.css";

export interface PodiumEntry {
  position: number;
  code: string;
  name: string;
  team: string;
  meta: string; // time / points / lap
}

const MEDAL = ["", "🥇", "🥈", "🥉"];

/** Top-3 of the selected session as three cards, P1 raised in the centre
 *  (AC-3 "wichtigste Ergebnisse" eye-catcher). Renders nothing without data. */
export function PodiumStrip({ entries }: { entries: PodiumEntry[] }): ReactNode {
  const top = entries.slice(0, 3);
  if (top.length === 0) return null;
  // Visual order: P2, P1, P3.
  const ordered = [top[1], top[0], top[2]].filter(Boolean) as PodiumEntry[];

  return (
    <div className={styles.podium}>
      {ordered.map((e) => {
        const color = teamColor(e.team);
        return (
          <div
            key={e.position}
            className={`${styles.podCard} ${e.position === 1 ? styles.podTop : ""}`}
          >
            <span className={styles.podBar} style={{ background: color.primary }} aria-hidden />
            <div className={styles.podPos}>
              {MEDAL[e.position] ?? ""} P{e.position}
            </div>
            <div className={styles.podCode} style={{ color: color.primary }}>
              {e.code}
            </div>
            <div className={styles.podName}>{e.name}</div>
            <div className={styles.podMeta}>
              {e.team} · {e.meta}
            </div>
          </div>
        );
      })}
    </div>
  );
}
