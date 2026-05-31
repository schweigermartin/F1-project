import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { CheckeredStrip } from "../components/art/RaceArt";
import seasonStyles from "../components/season/season.module.css";
import {
  CalendarCard,
  ConstructorStandingsCard,
  DriverStandingsCard,
  LastResultsCard,
  NextRaceHero,
} from "../components/season/SeasonWidgets";
import {
  getConstructorStandings,
  getDriverStandings,
  getLastResults,
  getSchedule,
  pickNextRace,
} from "../lib/f1-api";
import { PHOTOS, unsplash } from "../lib/images";

export const metadata: Metadata = {
  title: "F1 Portfolio — Saison 2026",
  description:
    "Aktuelle F1-Weltrangliste, Termine und Ergebnisse — plus Live-Dashboard und Architektur.",
};

// ISR: standings/results only change after a race — revalidate hourly.
export const revalidate = 3600;

/** Landing page: live championship standings, calendar and results (free Jolpica API). */
export default async function HomePage(): Promise<ReactNode> {
  const [drivers, constructors, schedule, last] = await Promise.all([
    getDriverStandings(),
    getConstructorStandings(),
    getSchedule(),
    getLastResults(),
  ]);

  const nextRace = schedule ? pickNextRace(schedule, new Date()) : null;

  return (
    <main className={seasonStyles.page}>
      <header className={seasonStyles.banner}>
        <img
          className={seasonStyles.bannerImg}
          src={unsplash(PHOTOS.carHero, 1600, 65)}
          alt=""
          aria-hidden
        />
        <div className={seasonStyles.bannerInner}>
          <nav style={{ display: "flex", gap: "1.25rem" }}>
            <Link href="/live" className={seasonStyles.back}>
              Live-Dashboard →
            </Link>
            <Link href="/architecture" className={seasonStyles.back}>
              Architektur →
            </Link>
          </nav>
          <h1 className={seasonStyles.title}>F1 Portfolio — Saison 2026</h1>
          <p className={seasonStyles.lead}>
            Aktuelle Weltrangliste, der nächste Grand Prix und die jüngsten Ergebnisse — live aus
            der freien Jolpica-F1-API, stündlich aktualisiert. Für die Live-Telemetrie geht es zum{" "}
            <Link href="/live" style={{ color: "var(--accent)" }}>
              Dashboard
            </Link>
            , zum Aufbau auf die{" "}
            <Link href="/architecture" style={{ color: "var(--accent)" }}>
              Architektur-Seite
            </Link>
            .
          </p>
        </div>
        <CheckeredStrip height={12} />
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
        (Ergast-kompatibel, frei) · server-seitig gecacht.
      </footer>
    </main>
  );
}
