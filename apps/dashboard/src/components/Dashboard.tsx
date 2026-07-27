"use client";

import type { ReplaySpeed } from "@f1/shared";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo } from "react";

import { useRaceSocket } from "../hooks/use-race-socket";
import type { ArchivedSession } from "../lib/archived-sessions";
import { DEMO_SNAPSHOT } from "../lib/demo-data";
import { gapChartData, sortedDrivers } from "../lib/format";
import { useRaceStore } from "../store/race-store";
import { ConnectionStatus } from "./ConnectionStatus";
import { GapChart } from "./GapChart";
import styles from "./live.module.css";
import { ReplayControls } from "./ReplayControls";
import { TimingTower } from "./TimingTower";
import { WeatherStrip } from "./WeatherStrip";

const Card = ({ children, title }: { children: ReactNode; title: string }): ReactNode => (
  <section className={styles.card}>
    <h2 className={styles.cardTitle}>{title}</h2>
    {children}
  </section>
);

export interface DashboardProps {
  /** Past sessions of the season, newest first — fetched by the `/live` page. */
  sessions: ArchivedSession[];
}

export function Dashboard({ sessions }: DashboardProps): ReactNode {
  const controls = useRaceSocket();

  const drivers = useRaceStore((s) => s.drivers);
  const weather = useRaceStore((s) => s.weather);
  const connection = useRaceStore((s) => s.connection);
  const mode = useRaceStore((s) => s.mode);
  const noLiveSession = useRaceStore((s) => s.noLiveSession);

  // Seed canned data when there's no backend configured, so the dashboard is
  // never blank locally / in a preview without a deployed WS API.
  useEffect(() => {
    if (!process.env["NEXT_PUBLIC_WS_URL"]) {
      useRaceStore.getState().applySnapshot(DEMO_SNAPSHOT);
    }
  }, []);

  const ordered = useMemo(() => sortedDrivers(drivers), [drivers]);
  const bars = useMemo(() => gapChartData(drivers), [drivers]);
  const empty = ordered.length === 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>F1 Live Dashboard</h1>
          <Link href="/" className={styles.navLink}>
            ← Start
          </Link>
          <Link href="/architecture" className={styles.navLink}>
            Architektur →
          </Link>
        </div>
        <ConnectionStatus status={connection} mode={mode} />
      </header>

      <WeatherStrip weather={weather} />

      <ReplayControls
        mode={mode}
        noLiveSession={noLiveSession}
        sessions={sessions}
        onStart={controls.startReplay}
        onStop={controls.stopReplay}
      />

      {empty ? (
        <NoSessionState
          sessions={sessions}
          replayPending={mode === "replay"}
          onStart={controls.startReplay}
        />
      ) : (
        <div className={styles.grid}>
          <Card title="Timing">
            <TimingTower drivers={ordered} />
          </Card>
          <Card title="Gap to leader">
            <GapChart bars={bars} />
          </Card>
        </div>
      )}
    </main>
  );
}

/**
 * What `/live` shows when no data is on screen (Phase 9, T21, AC-8).
 *
 * This used to be the string "Waiting for session data…" — literally true and
 * completely useless for the ~50 weeks a year in which nothing is waiting to
 * arrive. Constitution V asks the demo to work at any time, so the dead end
 * becomes the one action that always works: the most recent past session,
 * preloaded and one click from playing.
 *
 * It also stays honest about the limit (spec R-3): sessions from before the
 * post-session ingest went live have no archive yet, and the replay Lambda
 * answers those with `session-not-archived` rather than an error — so the copy
 * says what to do if nothing shows up.
 */
function NoSessionState({
  sessions,
  replayPending,
  onStart,
}: {
  sessions: ArchivedSession[];
  replayPending: boolean;
  onStart: (sessionId: string, speed: ReplaySpeed) => void;
}): ReactNode {
  const latest = sessions[0];

  if (replayPending) {
    return (
      <section className={styles.offline}>
        <div className={styles.offlineKicker}>Replay</div>
        <h2 className={styles.offlineTitle}>Replay wird geladen …</h2>
        <p className={styles.offlineText}>
          Die ersten Runden erscheinen gleich. Bleibt es leer, liegt für diese Session noch kein
          Archiv im S3-Bucket — wähle oben eine andere Session.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.offline}>
      <div className={styles.offlineKicker}>Keine laufende Session</div>
      <h2 className={styles.offlineTitle}>
        {latest ? "Letzte Session startbereit" : "Gerade keine Daten"}
      </h2>
      {latest ? (
        <>
          <p className={styles.offlineText}>
            Zwischen zwei Rennwochenenden fließen keine Live-Daten — das sind die meisten Tage im
            Jahr. Statt einer leeren Seite liegt hier die zuletzt gefahrene Session bereit: ein
            Klick spielt sie aus dem Archiv in Originalgeschwindigkeit ab. Kommen keine Runden an,
            wurde diese Session noch nicht archiviert; nimm dann eine andere aus der Liste oben.
          </p>
          <div className={styles.offlineActions}>
            <button
              type="button"
              className={styles.action}
              onClick={() => onStart(latest.session_key.toString(), 1)}
            >
              Replay starten
            </button>
            <span className={styles.offlineSession}>{latest.label}</span>
          </div>
        </>
      ) : (
        <p className={styles.offlineText}>
          Es läuft keine Session und die Liste vergangener Sessions ist gerade nicht erreichbar. Der
          Season Explorer zeigt währenddessen jedes gefahrene Rennen der Saison mit Ergebnis,
          Positionsverlauf und Strategie.
        </p>
      )}
      <div className={styles.offlineFooter}>
        <Link href="/" className={styles.navLink}>
          Zum Season Explorer →
        </Link>
      </div>
    </section>
  );
}
