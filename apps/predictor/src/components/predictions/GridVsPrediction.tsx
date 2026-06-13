import { driverTeamColor, type PredictionApiResponse } from "@f1/shared";
import type { ReactNode } from "react";

import { sortByPodium } from "../../lib/predictions-api";
import type { GridSlot } from "../../lib/quali-api";
import type { DriverStanding } from "../../lib/standings-api";
import styles from "../hub.module.css";

export interface GridVsPredictionProps {
  response: PredictionApiResponse | null;
  grid: GridSlot[] | null;
  standings: DriverStanding[] | null;
}

/**
 * Starting grid vs. predicted podium probability (AC-6). Hidden entirely when
 * either qualifying data or predictions are missing.
 */
export function GridVsPrediction({ response, grid, standings }: GridVsPredictionProps): ReactNode {
  if (!response || response.drivers.length === 0 || !grid || grid.length === 0) return null;
  const gridByCode = new Map(grid.map((g) => [g.code, g.grid]));
  const top = sortByPodium(response.drivers).slice(0, 6);

  return (
    <section className={`card ${styles.col4}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Startplatz vs. Vorhersage</h2>
        <span className={styles.panelMeta}>Top 6</span>
      </div>
      <div className={styles.gvp}>
        {top.map((d) => {
          const start = gridByCode.get(d.driver_code);
          const team = driverTeamColor(d.driver_code, standings);
          return (
            <div key={d.driver_number} className={styles.gvpRow}>
              <span className={`${styles.gvpGrid} tnum`}>{start ? `P${start}` : "—"}</span>
              <span style={{ color: team.primary, fontWeight: 700 }}>{d.driver_code}</span>
              <span className="tnum">{Math.round(d.podium_probability * 100)} %</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
