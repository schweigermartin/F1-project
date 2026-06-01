import type { PredictionApiResponse } from "@f1/shared";

import type { ScheduledRace } from "./schedule";

/**
 * Seeded demo data for when no Read-API is configured
 * (`NEXT_PUBLIC_PREDICTIONS_API_URL` unset) — same idea as the dashboard's
 * demo mode: the page renders a deterministic board with no backend, so the
 * Playwright smoke (T12) is hermetic and a recruiter opening the bare preview
 * still sees something. Drivers are deliberately NOT in podium order so the
 * client-side sort (US-1) is observable.
 */

export const DEMO_RACE: ScheduledRace = {
  round: 9,
  date: "2026-06-07",
  name: "Großer Preis von Kanada (Demo)",
};

export const DEMO_PREDICTIONS: PredictionApiResponse = {
  schema_version: 1,
  race_date: DEMO_RACE.date,
  round: DEMO_RACE.round,
  model_version: "0.1.0",
  drivers: [
    {
      driver_number: 1,
      driver_code: "VER",
      podium_probability: 0.61,
      shap_top: [
        { feature: "driver_form", contribution: 0.22 },
        { feature: "grid_position", contribution: -0.18 },
      ],
      model_version: "0.1.0",
      predicted_at: "2026-06-07T13:00:00+00:00",
      explanation: {
        bedrock_text:
          "Verstappen startet von P3, aber seine starke Form und Renn-Pace machen ihn zum klaren Podiums-Kandidaten.",
        model_id: "claude-haiku-4-5",
        cached_at: "2026-06-07T13:00:05+00:00",
      },
    },
    {
      driver_number: 16,
      driver_code: "LEC",
      podium_probability: 0.83,
      shap_top: [
        { feature: "grid_position", contribution: 0.41 },
        { feature: "quali_gap_to_pole_s", contribution: 0.12 },
      ],
      model_version: "0.1.0",
      predicted_at: "2026-06-07T13:00:00+00:00",
      explanation: {
        bedrock_text:
          "Souveräne Pole-Position und konstante Quali-Pace: Leclerc ist der wahrscheinlichste Podiumsfahrer.",
        model_id: "claude-haiku-4-5",
        cached_at: "2026-06-07T13:00:05+00:00",
      },
    },
    {
      driver_number: 4,
      driver_code: "NOR",
      podium_probability: 0.47,
      shap_top: [{ feature: "constructor_form", contribution: 0.15 }],
      model_version: "0.1.0",
      predicted_at: "2026-06-07T13:00:00+00:00",
      explanation: null, // still waiting on Bedrock — exercises "Begründung folgt"
    },
    {
      driver_number: 44,
      driver_code: "HAM",
      podium_probability: 0.29,
      shap_top: [{ feature: "track_history", contribution: 0.2 }],
      model_version: "0.1.0",
      predicted_at: "2026-06-07T13:00:00+00:00",
      explanation: {
        bedrock_text:
          "Hamiltons starke Historie in Montréal hebt seine Chancen, der mittlere Startplatz begrenzt sie jedoch.",
        model_id: "claude-haiku-4-5",
        cached_at: "2026-06-07T13:00:05+00:00",
      },
    },
  ],
};
