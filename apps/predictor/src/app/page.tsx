import { isSessionActive, type Session } from "@f1/shared";
import type { ReactNode } from "react";

import { Flag } from "../components/Flag";
import { TrackHistory } from "../components/history/TrackHistory";
import hub from "../components/hub.module.css";
import { LiveResultPanel } from "../components/live/LiveResultPanel";
import { GridVsPrediction } from "../components/predictions/GridVsPrediction";
import { PodiumBoard } from "../components/predictions/PodiumBoard";
import { SeasonPerformance } from "../components/SeasonPerformance";
import { StandingsMini } from "../components/StandingsMini";
import { CircuitMap } from "../components/track/CircuitMap";
import { WeatherPanel } from "../components/weather/WeatherPanel";
import { SessionTimeline } from "../components/weekend/SessionTimeline";
import { WeekendHeader } from "../components/weekend/WeekendHeader";
import { type CircuitPath, getCircuitPath } from "../lib/circuits";
import {
  DEMO_CIRCUIT_PATH,
  DEMO_FINAL_TOP3,
  DEMO_FORECAST,
  DEMO_GRID,
  DEMO_PREDICTIONS,
  DEMO_RACE,
  DEMO_SEASON_EVALUATIONS,
  DEMO_SESSIONS,
  DEMO_STANDINGS,
  DEMO_WINNERS,
} from "../lib/demo-data";
import { fetchSeasonEvaluations } from "../lib/evaluations-api";
import { getTrackWinners, type TrackWinner } from "../lib/history-api";
import type { ActualSlot } from "../lib/live-diff";
import { getWeekendSessions } from "../lib/openf1-weekend";
import { fetchRacePredictions, sortByPodium } from "../lib/predictions-api";
import { getQualifyingGrid, type GridSlot } from "../lib/quali-api";
import { getSeasonSchedule, pickTargetRace, type ScheduledRace } from "../lib/schedule";
import { pickNextSession } from "../lib/session-format";
import { type DriverStanding, getDriverStandings } from "../lib/standings-api";
import { getRaceDayForecast, type RaceDayForecast } from "../lib/weather-api";

// ISR: re-resolve the weekend + its data every few minutes (cheap, free APIs).
export const revalidate = 300;

const DEMO = !process.env["NEXT_PUBLIC_PREDICTIONS_API_URL"];

/** allSettled helper: a rejected/each-failing source becomes `null`/`[]`. */
function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback;
}

export default async function PredictorPage(): Promise<ReactNode> {
  const now = new Date();
  const data = DEMO ? demoData() : await liveData(now);
  if (!data) return <EmptyShell />;

  const {
    race,
    sessions,
    forecast,
    circuitPath,
    winners,
    standings,
    grid,
    predictions,
    seasonEvaluations,
    finalTop3,
    liveSessionKey,
  } = data;

  const nextSession = pickNextSession(sessions, now);
  const sortedPred = predictions ? sortByPodium(predictions.drivers) : [];
  const predictedTop3 = sortedPred.slice(0, 3).map((d) => d.driver_code);
  const numberToCode: Record<number, string> = Object.fromEntries(
    (predictions?.drivers ?? []).map((d) => [d.driver_number, d.driver_code]),
  );
  // Accent the track map with the predicted leader's team colour.
  const leaderTeamAccent = "#e10600";

  return (
    <main>
      {DEMO ? (
        <p className={hub.kicker} style={{ textAlign: "center", marginBottom: "1rem" }}>
          Demo-Daten — keine Read-API konfiguriert
        </p>
      ) : null}

      <WeekendHeader race={race} nextSession={nextSession} />

      <div className={hub.grid}>
        <CircuitMap path={circuitPath} circuitName={race.circuit} accent={leaderTeamAccent} />
        <SessionTimeline sessions={sessions} race={race} now={now} />
        <WeatherPanel forecast={forecast} />

        <PodiumBoard
          response={predictions}
          raceName={race.name}
          raceDate={race.date}
          standings={standings}
        />
        <GridVsPrediction response={predictions} grid={grid} standings={standings} />

        <LiveResultPanel
          predictedTop3={predictedTop3}
          numberToCode={numberToCode}
          finalTop3={finalTop3}
          liveSessionKey={liveSessionKey}
        />
        <StandingsMini rows={standings} />

        <TrackHistory winners={winners} />
      </div>

      <SeasonPerformance response={seasonEvaluations} />
    </main>
  );
}

interface HubData {
  race: ScheduledRace;
  sessions: Session[];
  forecast: RaceDayForecast | null;
  circuitPath: CircuitPath | null;
  winners: TrackWinner[] | null;
  standings: DriverStanding[] | null;
  grid: GridSlot[] | null;
  predictions: Awaited<ReturnType<typeof fetchRacePredictions>>;
  seasonEvaluations: Awaited<ReturnType<typeof fetchSeasonEvaluations>>;
  finalTop3: ActualSlot[] | null;
  liveSessionKey: number | null;
}

function demoData(): HubData {
  return {
    race: DEMO_RACE,
    sessions: DEMO_SESSIONS,
    forecast: DEMO_FORECAST,
    circuitPath: DEMO_CIRCUIT_PATH,
    winners: DEMO_WINNERS,
    standings: DEMO_STANDINGS,
    grid: DEMO_GRID,
    predictions: DEMO_PREDICTIONS,
    seasonEvaluations: DEMO_SEASON_EVALUATIONS,
    finalTop3: DEMO_FINAL_TOP3,
    liveSessionKey: null,
  };
}

async function liveData(now: Date): Promise<HubData | null> {
  const schedule = await getSeasonSchedule();
  const race = schedule ? pickTargetRace(schedule, now) : null;
  if (!race) return null;
  const season = Number(race.date.slice(0, 4));

  const [sessionsR, forecastR, circuitR, winnersR, standingsR, gridR, predR, evalR] =
    await Promise.allSettled([
      getWeekendSessions({ date: race.date, ...(race.country ? { country: race.country } : {}) }),
      race.lat !== undefined && race.lon !== undefined
        ? getRaceDayForecast(race.lat, race.lon, race.date)
        : Promise.resolve(null),
      getCircuitPath({
        ...(race.circuit ? { circuit: race.circuit } : {}),
        ...(race.locality ? { locality: race.locality } : {}),
      }),
      race.circuitId ? getTrackWinners(race.circuitId) : Promise.resolve(null),
      getDriverStandings(),
      getQualifyingGrid(season, race.round),
      fetchRacePredictions(race.date, race.round),
      fetchSeasonEvaluations(season),
    ]);

  const sessions = settled(sessionsR, [] as Session[]);
  const seasonEvaluations = settled(evalR, null);
  // Reuse the season evaluation's actual_top3 for this round as the final result
  // (no extra fetch — the loop already computed it).
  const thisRaceEval = seasonEvaluations?.races.find((r) => r.round === race.round) ?? null;
  const finalTop3: ActualSlot[] | null = thisRaceEval
    ? thisRaceEval.actual_top3.map((d) => ({ position: d.position, code: d.driver_code }))
    : null;
  // Live only while an actual Race session is open (Constitution IV).
  const liveRace = sessions.find((s) => s.session_type === "Race" && isSessionActive(s, now));

  return {
    race,
    sessions,
    forecast: settled(forecastR, null),
    circuitPath: settled(circuitR, null),
    winners: settled(winnersR, null),
    standings: settled(standingsR, null),
    grid: settled(gridR, null),
    predictions: settled(predR, null),
    seasonEvaluations,
    finalTop3,
    liveSessionKey: liveRace?.session_key ?? null,
  };
}

function EmptyShell(): ReactNode {
  return (
    <main>
      <section className={`card ${hub.header}`}>
        <div className={hub.headerLeft}>
          <span className={hub.kicker}>
            <Flag code={null} />
            Rennwochenende
          </span>
          <h1 className={hub.raceName}>Kein Rennen gefunden</h1>
          <p className={hub.raceMeta}>
            Der Saisonkalender ist gerade nicht erreichbar — bitte später erneut laden.
          </p>
        </div>
      </section>
    </main>
  );
}
