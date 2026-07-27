import type { DriverState } from "@f1/shared";
import type { ReactNode } from "react";

import { formatGap, formatLapTime, tyreInfo } from "../lib/format";
import styles from "./live.module.css";

function TyreBadge({ compound, age }: { compound: string | null; age: number | null }): ReactNode {
  const { label, color } = tyreInfo(compound);
  return (
    <span className={styles.tyre}>
      {/* The ring colour identifies the compound — it's data, not theme, so it
          stays inline while everything around it comes from the tokens. */}
      <span className={styles.tyreDot} style={{ borderColor: color, color }}>
        {label}
      </span>
      <span className={styles.tyreAge}>{age === null ? "" : `${age}L`}</span>
    </span>
  );
}

export function TimingTower({ drivers }: { drivers: DriverState[] }): ReactNode {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.colPos}>Pos</th>
          <th>Driver</th>
          <th>Gap</th>
          <th>Interval</th>
          <th>Tyre</th>
          <th>Last lap</th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d) => (
          <tr key={d.driver_number}>
            <td className={styles.colPos}>{d.position ?? "—"}</td>
            <td>#{d.driver_number}</td>
            <td>{formatGap(d.gap_to_leader)}</td>
            <td>{formatGap(d.interval)}</td>
            <td>
              <TyreBadge compound={d.compound} age={d.tyre_age} />
            </td>
            <td>{formatLapTime(d.last_lap_duration)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
