import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import seasonStyles from "../../components/season/season.module.css";
import {
  CalendarCard,
  ConstructorStandingsCard,
  DriverStandingsCard,
  LastResultsCard,
  NextRaceHero,
} from "../../components/season/SeasonWidgets";
import {
  getConstructorStandings,
  getDriverStandings,
  getLastResults,
  getSchedule,
  pickNextRace,
} from "../../lib/f1-api";

export const metadata: Metadata = {
  title: "Saison — F1 Portfolio",
  description: "Aktuelle F1-Weltrangliste, Termine und Ergebnisse (Live-Daten via Jolpica).",
};

// ISR: standings/results only change after a race — revalidate hourly.
export const revalidate = 3600;

/** /season — live championship standings, calendar and results (free Jolpica API). */
export default async function SeasonPage(): Promise<ReactNode> {
  const [drivers, constructors, schedule, last] = await Promise.all([
    getDriverStandings(),
    getConstructorStandings(),
    getSchedule(),
    getLastResults(),
  ]);

  const nextRace = schedule ? pickNextRace(schedule, new Date()) : null;

  return (
    <main className={seasonStyles.page}>
      <header>
        <Link href="/" className={seasonStyles.back}>
          ← Live-Dashboard
        </Link>
        <h1 className={seasonStyles.title}>Saison 2026</h1>
        <p className={seasonStyles.lead}>
          Aktuelle Weltrangliste, der nächste Grand Prix und die jüngsten Ergebnisse — live aus der
          freien Jolpica-F1-API, stündlich aktualisiert.
        </p>
      </header>

      <NextRaceHero race={nextRace} />

      <div className={seasonStyles.grid}>
        <DriverStandingsCard rows={drivers} />
        <ConstructorStandingsCard rows={constructors} />
        <LastResultsCard race={last} />
        <CalendarCard races={schedule} nextRound={nextRace?.round ?? null} />
      </div>

      <footer className={seasonStyles.footer}>
        Daten:{" "}
        <a href="https://jolpi.ca/" target="_blank" rel="noreferrer">
          Jolpica-F1
        </a>{" "}
        (Ergast-kompatibel, frei) · server-seitig gecacht. Mehr zum System auf der{" "}
        <Link href="/architecture" style={{ color: "var(--accent)" }}>
          Architektur-Seite
        </Link>
        .
      </footer>
    </main>
  );
}
