import { teamColor } from "@f1/shared";
import type { ReactNode } from "react";

import type { DriverFocus } from "../../lib/explorer";
import styles from "./explorer.module.css";

function Stat({ value, label }: { value: string; label: string }): ReactNode {
  return (
    <div>
      <div className={styles.statVal}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

/** Driver-focus card (AC-4): championship + selected-race context for one driver.
 *  Rendered only when a driver is focused; the card derives from already-loaded
 *  data (no extra fetch). */
export function DriverFocusCard({
  focus,
  raceName,
}: {
  focus: DriverFocus | null;
  raceName: string;
}): ReactNode {
  if (!focus) return null;
  const color = teamColor(focus.constructor);
  return (
    <section className={styles.focus} style={{ borderLeftColor: color.primary }}>
      <div>
        <div className={styles.focusName} style={{ color: color.primary }}>
          {focus.name}
        </div>
        <div className={styles.focusTeam}>{focus.constructor}</div>
      </div>
      <div className={styles.focusStats}>
        <Stat value={focus.championshipPos ? `P${focus.championshipPos}` : "—"} label="WM-Platz" />
        <Stat value={focus.points ?? "—"} label="Punkte" />
        <Stat value={focus.wins ?? "—"} label="Siege" />
        {focus.raceResult ? (
          <>
            <Stat value={`P${focus.raceResult.position}`} label={`${raceName} Ziel`} />
            {focus.raceResult.grid ? (
              <Stat value={`P${focus.raceResult.grid}`} label="Start" />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
