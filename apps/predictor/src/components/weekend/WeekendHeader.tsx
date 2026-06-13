import type { Session } from "@f1/shared";
import type { ReactNode } from "react";

import { countryToCode } from "../../lib/flags";
import type { ScheduledRace } from "../../lib/schedule";
import { Flag } from "../Flag";
import styles from "../hub.module.css";
import { Countdown } from "./Countdown";

const MONTHS_DE = [
  "Jan.",
  "Feb.",
  "März",
  "Apr.",
  "Mai",
  "Juni",
  "Juli",
  "Aug.",
  "Sep.",
  "Okt.",
  "Nov.",
  "Dez.",
];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d}. ${MONTHS_DE[m - 1] ?? ""} ${y}`;
}

const SESSION_LABELS: Record<string, string> = {
  Race: "Rennen",
  Qualifying: "Qualifying",
  Sprint: "Sprint",
  "Sprint Qualifying": "Sprint-Quali",
  "Sprint Shootout": "Sprint-Shootout",
};

export interface WeekendHeaderProps {
  race: ScheduledRace;
  /** Next/live session to count down to (null off-weekend → countdown to race). */
  nextSession: Session | null;
}

export function WeekendHeader({ race, nextSession }: WeekendHeaderProps): ReactNode {
  const where = [race.locality, race.country].filter(Boolean).join(", ");
  // Count down to the next session if known, else to the race start time.
  const target = nextSession?.date_start ?? race.startsAt ?? null;
  const targetLabel = nextSession
    ? (SESSION_LABELS[nextSession.session_name] ?? nextSession.session_name)
    : "Rennstart";

  return (
    <section className={`card ${styles.header}`}>
      <div className={styles.headerLeft}>
        <span className={styles.kicker}>Rennwochenende · Runde {race.round}</span>
        <h1 className={styles.raceName}>
          <Flag code={countryToCode(race.country)} title={race.country} />
          {race.name}
        </h1>
        <div className={styles.raceMeta}>
          {[race.circuit, where, fmtDate(race.date)].filter(Boolean).join(" · ")}
        </div>
      </div>
      {target ? <Countdown targetIso={target} label={targetLabel} /> : null}
    </section>
  );
}
