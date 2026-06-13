import type { Session } from "@f1/shared";
import type { ReactNode } from "react";

import type { ScheduledRace } from "../../lib/schedule";
import { formatSessionTime, pickNextSession, sessionStatus } from "../../lib/session-format";
import styles from "../hub.module.css";

const SESSION_LABELS: Record<string, string> = {
  "Practice 1": "Freies Training 1",
  "Practice 2": "Freies Training 2",
  "Practice 3": "Freies Training 3",
  Qualifying: "Qualifying",
  Sprint: "Sprint",
  "Sprint Qualifying": "Sprint-Qualifying",
  "Sprint Shootout": "Sprint-Shootout",
  Race: "Rennen",
};

export interface SessionTimelineProps {
  sessions: Session[];
  race: ScheduledRace;
  /** Stable "now" passed from the page for SSR-consistent status. */
  now: Date;
}

export function SessionTimeline({ sessions, race, now }: SessionTimelineProps): ReactNode {
  return (
    <section className={`card ${styles.col4}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Zeitplan</h2>
        <span className={styles.panelMeta}>lokale Zeit</span>
      </div>
      {sessions.length === 0 ? (
        // Fallback (AC-2): no OpenF1 sessions → at least the race day from Jolpica.
        <p className={styles.empty}>
          Detaillierter Zeitplan noch nicht verfügbar — Rennen am{" "}
          {race.startsAt ? formatSessionTime(race.startsAt) : race.date}.
        </p>
      ) : (
        <div className={styles.timeline}>
          {(() => {
            const next = pickNextSession(sessions, now);
            return sessions.map((s) => {
              const status = sessionStatus(s, now);
              const isNext = next?.session_key === s.session_key && status === "upcoming";
              const cls = [
                styles.session,
                status === "live" ? styles.sessionLive : "",
                status === "past" ? styles.sessionPast : "",
                isNext ? styles.sessionNext : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div key={s.session_key} className={cls}>
                  <span className={styles.sessionDot} aria-hidden />
                  <span className={styles.sessionName}>
                    {SESSION_LABELS[s.session_name] ?? s.session_name}
                    {status === "live" ? <span className={styles.liveTag}> · live</span> : null}
                  </span>
                  <span className={`${styles.sessionTime} tnum`}>
                    {formatSessionTime(s.date_start)}
                  </span>
                </div>
              );
            });
          })()}
        </div>
      )}
    </section>
  );
}
