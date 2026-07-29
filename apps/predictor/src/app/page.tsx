import { isSessionActive, type Session } from "@f1/shared";
import type { ReactNode } from "react";

import { Flag } from "../components/Flag";
import { TrackHistory } from "../components/history/TrackHistory";
import hub from "../components/hub.module.css";
import { LiveResultPanel } from "../components/live/LiveResultPanel";
import { BaselineComparison } from "../components/predictions/BaselineComparison";
import { GridVsPrediction } from "../components/predictions/GridVsPrediction";
import { PodiumBoard } from "../components/predictions/PodiumBoard";
import { SeasonPerformance } from "../components/SeasonPerformance";
import { StandingsMini } from "../components/StandingsMini";
import { CircuitMap } from "../components/track/CircuitMap";
import { WeatherPanel } from "../components/weather/WeatherPanel";
import { SessionTimeline } from "../components/weekend/SessionTimeline";
import { WeekendHeader } from "../components/weekend/WeekendHeader";
import { type CircuitPath, getCircuitPath } from "../lib/circuits";
import { DEMO_FINAL_TOP3, DEMO_PREDICTIONS, DEMO_SEASON_EVALUATIONS } from "../lib/demo-data";
import { fetchSeasonEvaluations } from "../lib/evaluations-api";
import { getTrackWinners, type TrackWinner } from "../lib/history-api";
import type { ActualSlot } from "../lib/live-diff";
import { getWeekendSessions } from "../lib/openf1-weekend";
import { fetchRacePredictions, sortByPodium } from "../lib/predictions-api";
import { getQualifyingGrid, type GridSlot } from "../lib/quali-api";
import { getRaceResult } from "../lib/race-result-api";
import {
  getSeasonSchedule,
  raceHasHappened,
  resolveRound,
  type ScheduledRace,
} from "../lib/schedule";
import { pickNextSession } from "../lib/session-format";
import { type DriverStanding, getDriverStandings } from "../lib/standings-api";
import { getRaceDayForecast, type RaceDayForecast } from "../lib/weather-api";

// ISR: re-resolve the weekend + its data every few minutes (cheap, free APIs).
export const revalidate = 300;

// T12: DEMO now scopes *only* the prediction/evaluation slice (plan §2.3) —
// weather, schedule, circuit map, standings and track history need no
// Read-API and always fetch live, whether or not one is configured.
const DEMO = !process.env["NEXT_PUBLIC_PREDICTIONS_API_URL"];

interface PageProps {
  searchParams: Promise<{ round?: string | undefined }>;
}

/** allSettled helper: a rejected/each-failing source becomes `null`/`[]`. */
function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback;
}

export default async function PredictorPage({ searchParams }: PageProps): Promise<ReactNode> {
  const now = new Date();
  const { round } = await searchParams;
  const data = await liveData(now, round);
  if (!data) return <EmptyShell />;

  const {
    race,
    schedule,
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
          Demo-Vorhersage — keine Read-API konfiguriert (Wetter, Kalender, Strecke und Historie sind
          live)
        </p>
      ) : null}

      <WeekendHeader race={race} nextSession={nextSession} schedule={schedule} />

      <div className={hub.grid}>
        <CircuitMap path={circuitPath} circuitName={race.circuit} accent={leaderTeamAccent} />
        <SessionTimeline sessions={sessions} race={race} now={now} />
        <WeatherPanel forecast={forecast} />

        <PodiumBoard
          key={race.round}
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
        {/* AC-8: purely derived from data already fetched above — no new request. */}
        <BaselineComparison predictedTop3={predictedTop3} grid={grid} finalTop3={finalTop3} />
        <StandingsMini rows={standings} />

        <TrackHistory winners={winners} />
      </div>

      <SeasonPerformance response={seasonEvaluations} />
    </main>
  );
}

interface HubData {
  race: ScheduledRace;
  /** Full season schedule — powers the round selector (T10/AC-4). */
  schedule: ScheduledRace[];
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

/**
 * Resolves the selected round (`?round=N`, default next-or-last, T9) and
 * fetches every panel's data. Per T12, only `predictions`/`seasonEvaluations`/
 * `finalTop3` fall back to demo fixtures when no Read-API is configured —
 * everything else (schedule, weather, circuit, standings, history) needs no
 * env var and always hits the free live APIs, demo mode or not (plan §2.3).
 */
async function liveData(now: Date, roundParam: string | undefined): Promise<HubData | null> {
  const schedule = (await getSeasonSchedule()) ?? [];
  const race = schedule.length > 0 ? resolveRound(roundParam, schedule, now) : null;
  if (!race) return null;
  const season = Number(race.date.slice(0, 4));
  // T11: only bother asking Jolpica for a result once the race can have one.
  const raceHappened = raceHasHappened(race.date, now);

  const [sessionsR, forecastR, circuitR, winnersR, standingsR, gridR, predR, evalR, resultR] =
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
      DEMO ? Promise.resolve(DEMO_PREDICTIONS) : fetchRacePredictions(race.date, race.round),
      DEMO ? Promise.resolve(DEMO_SEASON_EVALUATIONS) : fetchSeasonEvaluations(season),
      // T11: fetch the real Jolpica result directly — independent of whether
      // the Phase-5 evaluation pipeline has run for this race yet.
      !DEMO && raceHappened ? getRaceResult(season, race.round) : Promise.resolve(null),
    ]);

  const sessions = settled(sessionsR, [] as Session[]);
  const seasonEvaluations = settled(evalR, null);
  const jolpicaResult = settled(resultR, null);
  // Fall back to the season evaluation's actual_top3 for this round if the
  // direct Jolpica fetch failed or hasn't run — both describe the same
  // finished race, so either is a valid source (AC-11 degrade).
  const thisRaceEval = seasonEvaluations?.races.find((r) => r.round === race.round) ?? null;
  const evalTop3: ActualSlot[] | null = thisRaceEval
    ? thisRaceEval.actual_top3.map((d) => ({ position: d.position, code: d.driver_code }))
    : null;
  const finalTop3: ActualSlot[] | null = DEMO ? DEMO_FINAL_TOP3 : (jolpicaResult ?? evalTop3);
  // Live only while an actual Race session is open (Constitution IV).
  const liveRace = sessions.find((s) => s.session_type === "Race" && isSessionActive(s, now));

  return {
    race,
    schedule,
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
