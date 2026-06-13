import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { CheckeredStrip } from "../components/art/RaceArt";
import { CalendarRail } from "../components/explorer/CalendarRail";
import { DriverFocusCard } from "../components/explorer/DriverFocusCard";
import explorer from "../components/explorer/explorer.module.css";
import { ExplorerBar } from "../components/explorer/ExplorerBar";
import { type PodiumEntry, PodiumStrip } from "../components/explorer/PodiumStrip";
import { ResultBoard } from "../components/explorer/ResultBoard";
import seasonStyles from "../components/season/season.module.css";
import {
  Card,
  ConstructorStandingsCard,
  DriverStandingsCard,
  NextRaceHero,
} from "../components/season/SeasonWidgets";
import { buildDriverFocus, resolveSelection, SESSION_OPTIONS, sessionLabel } from "../lib/explorer";
import {
  getConstructorStandings,
  getDriverStandings,
  getQualifyingResults,
  getRaceResults,
  getSchedule,
  pickNextRace,
  type QualiRow,
  type RaceResultRow,
} from "../lib/f1-api";
import { PHOTOS, unsplash } from "../lib/images";
import { type FastLapRow, getMeetingSessions, getPracticeFastestLaps } from "../lib/openf1";

export const metadata: Metadata = {
  title: "F1 Season Explorer — 2026",
  description:
    "Interaktiver F1-Saison-Explorer: jedes Rennen, jede Session (FP/Quali/Race) und Fahrer-Fokus — Ergebnisse, Podium und WM-Stand.",
};

// ISR: classifications are static once a session is done — revalidate hourly.
export const revalidate = 3600;

type Params = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const now = new Date();

  const [scheduleR, driversR, constructorsR] = await Promise.allSettled([
    getSchedule(),
    getDriverStandings(),
    getConstructorStandings(),
  ]);
  const schedule = settled(scheduleR, null);
  const drivers = settled(driversR, null);
  const constructors = settled(constructorsR, null);

  const sel = resolveSelection(
    { round: one(sp["round"]), session: one(sp["session"]), driver: one(sp["driver"]) },
    schedule,
    now,
  );
  const season = sel.race ? Number(sel.race.date.slice(0, 4)) : now.getUTCFullYear();
  const nextRace = schedule ? pickNextRace(schedule, now) : null;

  // Race results power the podium (race view), the driver-focus card and the
  // default view — fetch them for the selected round regardless of session.
  const raceRows: RaceResultRow[] | null = sel.race
    ? await getRaceResults(season, sel.round).catch(() => null)
    : null;

  // Session-specific classification.
  let quali: QualiRow[] | null = null;
  let practice: FastLapRow[] | null = null;
  if (sel.race && sel.session === "qualifying") {
    quali = await getQualifyingResults(season, sel.round).catch(() => null);
  } else if (sel.race && sel.session.startsWith("fp")) {
    const want = SESSION_OPTIONS.find((o) => o.key === sel.session)?.openF1Name;
    const sessions = await getMeetingSessions({
      date: sel.race.date,
      ...(sel.race.country ? { country: sel.race.country } : {}),
    });
    const match = want ? sessions.find((s) => s.session_name === want) : undefined;
    practice = match ? await getPracticeFastestLaps(match.session_key).catch(() => null) : null;
  }

  const podium = buildPodium(sel.session, raceRows, quali, practice);
  const focus = sel.driver ? buildDriverFocus(sel.driver, drivers, raceRows) : null;

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
          <nav style={{ display: "flex", gap: "0.75rem" }}>
            <Link href="/live" className={seasonStyles.back}>
              Live-Dashboard →
            </Link>
            <Link href="/architecture" className={seasonStyles.back}>
              Architektur →
            </Link>
          </nav>
          <h1 className={seasonStyles.title}>F1 Season Explorer — 2026</h1>
          <p className={seasonStyles.lead}>
            Jedes Rennen, jede Session, jeder Fahrer: wähle Runde, Session (FP/Quali/Rennen) und
            einen Fahrer-Fokus — Ergebnisse, Podium und WM-Stand aus der freien Jolpica- und
            OpenF1-API, server-seitig gecacht.
          </p>
        </div>
        <CheckeredStrip height={12} />
      </header>

      <ExplorerBar
        races={schedule ?? []}
        drivers={drivers ?? []}
        round={sel.round}
        session={sel.session}
        driver={sel.driver}
      />

      <NextRaceHero race={nextRace} />

      <DriverFocusCard focus={focus} raceName={sel.race?.name ?? "Rennen"} />

      <Card
        title={
          sel.race ? `${sel.race.name} · ${sessionLabel(sel.session)}` : sessionLabel(sel.session)
        }
        meta={sel.race ? `Runde ${sel.round}` : undefined}
      >
        <PodiumStrip entries={podium} />
        <ResultBoard
          session={sel.session}
          race={raceRows}
          quali={quali}
          practice={practice}
          focusDriver={sel.driver}
        />
      </Card>

      <div className={seasonStyles.grid} style={{ marginTop: "1.25rem" }}>
        <DriverStandingsCard rows={drivers} focusDriver={sel.driver} />
        <ConstructorStandingsCard rows={constructors} />
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <Card title="Saisonkalender" meta={schedule ? `${schedule.length} Rennen` : undefined} wide>
          {schedule ? (
            <CalendarRail
              races={schedule}
              selectedRound={sel.round}
              nextRound={nextRace?.round ?? null}
              session={sel.session}
              driver={sel.driver}
            />
          ) : (
            <p className={explorer.empty}>Kalender nicht verfügbar.</p>
          )}
        </Card>
      </div>

      <footer className={seasonStyles.footer}>
        Daten:{" "}
        <a href="https://jolpi.ca/" target="_blank" rel="noreferrer">
          Jolpica-F1
        </a>{" "}
        +{" "}
        <a href="https://openf1.org/" target="_blank" rel="noreferrer">
          OpenF1
        </a>{" "}
        (frei) · server-seitig gecacht.
      </footer>
    </main>
  );
}

/** Top-3 of the active session, normalized for the podium strip. */
function buildPodium(
  session: string,
  race: RaceResultRow[] | null,
  quali: QualiRow[] | null,
  practice: FastLapRow[] | null,
): PodiumEntry[] {
  if (session === "race" && race) {
    return race.slice(0, 3).map((r) => ({
      position: r.position,
      code: r.code,
      name: r.driver,
      team: r.constructor,
      meta: `${r.points} Pkt`,
    }));
  }
  if (session === "qualifying" && quali) {
    return quali.slice(0, 3).map((r) => ({
      position: r.position,
      code: r.code,
      name: r.driver,
      team: r.constructor,
      meta: r.best,
    }));
  }
  if (session.startsWith("fp") && practice) {
    return practice.slice(0, 3).map((r) => ({
      position: r.position,
      code: r.code,
      name: r.code,
      team: r.constructor,
      meta: r.time,
    }));
  }
  return [];
}
