import type { ReactNode } from "react";

import { PodiumPredictions } from "../components/PodiumPredictions";
import { SeasonPerformance } from "../components/SeasonPerformance";
import { DEMO_PREDICTIONS, DEMO_RACE, DEMO_SEASON_EVALUATIONS } from "../lib/demo-data";
import { fetchSeasonEvaluations } from "../lib/evaluations-api";
import { fetchRacePredictions } from "../lib/predictions-api";
import { getSeasonSchedule, pickTargetRace } from "../lib/schedule";

// ISR: re-resolve the target race + its predictions every few minutes (a race
// is predicted at most once, so this is fresh enough and keeps cost low).
export const revalidate = 300;

// No Read-API configured → demo mode (seeded board, no backend) — mirrors the
// dashboard's demo fallback, and makes the T12 Playwright smoke hermetic.
const DEMO = !process.env["NEXT_PUBLIC_PREDICTIONS_API_URL"];

export default async function PredictorPage(): Promise<ReactNode> {
  const target = DEMO ? DEMO_RACE : await resolveTargetRace();
  // Season of the target race = the season the chart shows (Phase 5, AC-3).
  const season = target ? Number(target.date.slice(0, 4)) : new Date().getUTCFullYear();
  const [response, seasonEvaluations] = DEMO
    ? [DEMO_PREDICTIONS, DEMO_SEASON_EVALUATIONS]
    : await Promise.all([
        target ? fetchRacePredictions(target.date, target.round) : Promise.resolve(null),
        fetchSeasonEvaluations(season),
      ]);

  return (
    <main>
      <h1 style={{ textAlign: "center", marginBottom: "0.25rem" }}>Podiums-Predictor</h1>
      <p style={{ textAlign: "center", color: "var(--muted)", marginTop: 0 }}>
        Modellbasierte Podiums-Wahrscheinlichkeit pro Fahrer, erklärt von Claude.
      </p>
      {DEMO ? (
        <p style={{ textAlign: "center", color: "var(--muted)", marginTop: 0, fontSize: "0.8rem" }}>
          Demo-Daten — keine Read-API konfiguriert.
        </p>
      ) : null}
      <PodiumPredictions
        response={response}
        raceName={target?.name ?? null}
        raceDate={target?.date ?? null}
      />
      <SeasonPerformance response={seasonEvaluations} />
    </main>
  );
}

async function resolveTargetRace(): Promise<{ date: string; round: number; name: string } | null> {
  const schedule = await getSeasonSchedule();
  return schedule ? pickTargetRace(schedule, new Date()) : null;
}
