import { teamColor } from "@f1/shared";
import type { ReactNode } from "react";

import type { DriverStanding } from "../lib/standings-api";
import styles from "./hub.module.css";

/** Compact championship context — top drivers, team-colour dotted. */
export function StandingsMini({ rows }: { rows: DriverStanding[] | null }): ReactNode {
  return (
    <section className={`card ${styles.col4}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>WM-Stand</h2>
        <span className={styles.panelMeta}>Fahrer</span>
      </div>
      {!rows || rows.length === 0 ? (
        <p className={styles.empty}>WM-Stand nicht verfügbar.</p>
      ) : (
        <table className={styles.standTable}>
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.code}>
                <td className={`${styles.standPos} tnum`}>{r.position}</td>
                <td>
                  <span
                    className={styles.teamDot}
                    style={{
                      background: teamColor(r.constructor).primary,
                      display: "inline-block",
                      marginRight: "0.5rem",
                    }}
                    aria-hidden
                  />
                  <span style={{ fontWeight: 600 }}>{r.code}</span>
                </td>
                <td className={`${styles.standPts} tnum`}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
