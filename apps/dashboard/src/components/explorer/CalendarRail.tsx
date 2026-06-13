import Link from "next/link";
import type { ReactNode } from "react";

import type { SessionKey } from "../../lib/explorer";
import type { RaceMeta } from "../../lib/f1-api";
import { countryToCode } from "../../lib/flags";
import { Flag } from "../Flag";
import styles from "./explorer.module.css";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return m && d ? `${d}. ${MONTHS[m - 1]}` : iso;
}

/** Compact season calendar; each race links to `?round=N` (keeping session +
 *  driver focus), the selected race is marked, past races dimmed (AC-5). */
export function CalendarRail({
  races,
  selectedRound,
  nextRound,
  session,
  driver,
}: {
  races: RaceMeta[];
  selectedRound: number;
  nextRound: number | null;
  session: SessionKey;
  driver: string | null;
}): ReactNode {
  return (
    <div className={styles.rail}>
      {races.map((r) => {
        const params = new URLSearchParams({ round: String(r.round) });
        if (session !== "race") params.set("session", session);
        if (driver) params.set("driver", driver);
        const isSelected = r.round === selectedRound;
        const isPast = nextRound !== null && r.round < nextRound;
        return (
          <Link
            key={r.round}
            href={`/?${params.toString()}`}
            scroll={false}
            className={`${styles.railItem} ${isSelected ? styles.railSelected : ""} ${
              isPast ? styles.railPast : ""
            }`}
          >
            <span className={styles.railRound}>R{r.round}</span>
            <span className={styles.railName}>
              <Flag code={countryToCode(r.country)} title={r.country} size={16} /> {r.name}
            </span>
            <span className={styles.railDate}>{shortDate(r.date)}</span>
          </Link>
        );
      })}
    </div>
  );
}
