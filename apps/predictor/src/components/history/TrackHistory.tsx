import { teamColor } from "@f1/shared";
import type { ReactNode } from "react";

import type { TrackWinner } from "../../lib/history-api";
import styles from "../hub.module.css";

/** Recent winners at this circuit (AC-7), team-colour dotted. Empty → note. */
export function TrackHistory({ winners }: { winners: TrackWinner[] | null }): ReactNode {
  return (
    <section className={`card ${styles.col4}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Sieger hier</h2>
        <span className={styles.panelMeta}>letzte Jahre</span>
      </div>
      {!winners || winners.length === 0 ? (
        <p className={styles.empty}>Keine Streckenhistorie verfügbar.</p>
      ) : (
        <div className={styles.histList}>
          {winners.map((w) => {
            const color = teamColor(w.constructor);
            return (
              <div key={`${w.year}-${w.code}`} className={styles.histRow}>
                <span className={`${styles.histYear} tnum`}>{w.year}</span>
                <span
                  className={styles.teamDot}
                  style={{ background: color.primary }}
                  aria-hidden
                />
                <span style={{ fontWeight: 600 }}>{w.driver}</span>
                <span className={styles.histTeam}>{w.constructor}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
