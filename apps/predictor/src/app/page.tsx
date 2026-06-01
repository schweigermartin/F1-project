import type { ReactNode } from "react";

import { PodiumPredictions } from "../components/PodiumPredictions";
import { fetchRacePredictions } from "../lib/predictions-api";
import { getSeasonSchedule, pickTargetRace } from "../lib/schedule";

// ISR: re-resolve the target race + its predictions every few minutes (a race
// is predicted at most once, so this is fresh enough and keeps cost low).
export const revalidate = 300;

export default async function PredictorPage(): Promise<ReactNode> {
  const schedule = await getSeasonSchedule();
  const target = schedule ? pickTargetRace(schedule, new Date()) : null;
  const response = target ? await fetchRacePredictions(target.date, target.round) : null;

  return (
    <main>
      <h1 style={{ textAlign: "center", marginBottom: "0.25rem" }}>Podiums-Predictor</h1>
      <p style={{ textAlign: "center", color: "var(--muted)", marginTop: 0 }}>
        Modellbasierte Podiums-Wahrscheinlichkeit pro Fahrer, erklärt von Claude.
      </p>
      <PodiumPredictions
        response={response}
        raceName={target?.name ?? null}
        raceDate={target?.date ?? null}
      />
    </main>
  );
}
