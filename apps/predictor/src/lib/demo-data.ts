import type { PredictionApiResponse, SeasonEvaluationResponse, Session } from "@f1/shared";

import type { CircuitPath } from "./circuits";
import type { TrackWinner } from "./history-api";
import type { ActualSlot } from "./live-diff";
import type { GridSlot } from "./quali-api";
import type { ScheduledRace } from "./schedule";
import type { DriverStanding } from "./standings-api";
import type { RaceDayForecast } from "./weather-api";

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
  startsAt: "2026-06-07T18:00:00Z",
  circuitId: "villeneuve",
  circuit: "Circuit Gilles Villeneuve",
  locality: "Montreal",
  country: "Canada",
  lat: 45.5,
  lon: -73.5228,
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

/** Three evaluated demo races so the season chart (Phase 5) renders a visible
 * trend in demo mode and the Playwright smoke can assert on it. */
export const DEMO_SEASON_EVALUATIONS: SeasonEvaluationResponse = {
  schema_version: 1,
  season: 2026,
  races: [
    {
      race_date: "2026-05-03",
      round: 6,
      season: 2026,
      model_version: "0.1.0",
      n_drivers: 20,
      top3_hit_rate: 1 / 3,
      brier_score: 0.19,
      predicted_top3: [
        { driver_number: 1, driver_code: "VER", podium_probability: 0.72 },
        { driver_number: 16, driver_code: "LEC", podium_probability: 0.64 },
        { driver_number: 44, driver_code: "HAM", podium_probability: 0.41 },
      ],
      actual_top3: [
        { driver_number: 4, driver_code: "NOR", position: 1 },
        { driver_number: 81, driver_code: null, position: 2 },
        { driver_number: 1, driver_code: "VER", position: 3 },
      ],
      evaluated_at: "2026-05-03T17:05:00+00:00",
    },
    {
      race_date: "2026-05-24",
      round: 8,
      season: 2026,
      model_version: "0.2.0",
      n_drivers: 20,
      top3_hit_rate: 2 / 3,
      brier_score: 0.13,
      predicted_top3: [
        { driver_number: 16, driver_code: "LEC", podium_probability: 0.78 },
        { driver_number: 1, driver_code: "VER", podium_probability: 0.69 },
        { driver_number: 4, driver_code: "NOR", podium_probability: 0.55 },
      ],
      actual_top3: [
        { driver_number: 16, driver_code: "LEC", position: 1 },
        { driver_number: 1, driver_code: "VER", position: 2 },
        { driver_number: 44, driver_code: "HAM", position: 3 },
      ],
      evaluated_at: "2026-05-24T16:40:00+00:00",
    },
    {
      race_date: DEMO_RACE.date,
      round: DEMO_RACE.round,
      season: 2026,
      model_version: "0.2.0",
      n_drivers: 20,
      top3_hit_rate: 1,
      brier_score: 0.08,
      predicted_top3: [
        { driver_number: 16, driver_code: "LEC", podium_probability: 0.83 },
        { driver_number: 1, driver_code: "VER", podium_probability: 0.61 },
        { driver_number: 4, driver_code: "NOR", podium_probability: 0.47 },
      ],
      actual_top3: [
        { driver_number: 16, driver_code: "LEC", position: 1 },
        { driver_number: 4, driver_code: "NOR", position: 2 },
        { driver_number: 1, driver_code: "VER", position: 3 },
      ],
      evaluated_at: "2026-06-07T17:00:00+00:00",
    },
  ],
};

// ─── Phase 7 hub panels ──────────────────────────────────────────────────────

function demoSession(name: string, type: string, start: string, end: string, key: number): Session {
  return {
    session_key: key,
    session_type: type,
    session_name: name,
    date_start: start,
    date_end: end,
    meeting_key: 9999,
    circuit_key: 23,
    circuit_short_name: "Montreal",
    country_key: 46,
    country_code: "CAN",
    country_name: "Canada",
    location: "Montreal",
    gmt_offset: "-04:00:00",
    year: 2026,
    is_cancelled: false,
  };
}

export const DEMO_SESSIONS: Session[] = [
  demoSession(
    "Practice 1",
    "Practice",
    "2026-06-05T17:30:00+00:00",
    "2026-06-05T18:30:00+00:00",
    9001,
  ),
  demoSession(
    "Practice 2",
    "Practice",
    "2026-06-05T21:00:00+00:00",
    "2026-06-05T22:00:00+00:00",
    9002,
  ),
  demoSession(
    "Practice 3",
    "Practice",
    "2026-06-06T16:30:00+00:00",
    "2026-06-06T17:30:00+00:00",
    9003,
  ),
  demoSession(
    "Qualifying",
    "Qualifying",
    "2026-06-06T20:00:00+00:00",
    "2026-06-06T21:00:00+00:00",
    9004,
  ),
  demoSession("Race", "Race", "2026-06-07T18:00:00+00:00", "2026-06-07T20:00:00+00:00", 9005),
];

export const DEMO_FORECAST: RaceDayForecast = {
  date: DEMO_RACE.date,
  tempMax: 24,
  tempMin: 16,
  precipProb: 30,
  windMax: 18,
};

/** Stylized loop so the map renders in demo mode without the external GeoJSON. */
export const DEMO_CIRCUIT_PATH: CircuitPath = {
  d: "M18 52 L26 32 L44 22 L64 24 L80 36 L84 54 L74 68 L54 74 L36 72 L24 64 Z",
  start: { x: 18, y: 52 },
  viewBox: "0 0 100 100",
  width: 100,
  height: 100,
};

export const DEMO_STANDINGS: DriverStanding[] = [
  {
    position: 1,
    points: "169",
    wins: "4",
    name: "Lando Norris",
    code: "NOR",
    constructor: "McLaren",
  },
  {
    position: 2,
    points: "154",
    wins: "3",
    name: "Charles Leclerc",
    code: "LEC",
    constructor: "Ferrari",
  },
  {
    position: 3,
    points: "148",
    wins: "2",
    name: "Max Verstappen",
    code: "VER",
    constructor: "Red Bull Racing",
  },
  {
    position: 4,
    points: "132",
    wins: "1",
    name: "Oscar Piastri",
    code: "PIA",
    constructor: "McLaren",
  },
  {
    position: 5,
    points: "98",
    wins: "0",
    name: "George Russell",
    code: "RUS",
    constructor: "Mercedes",
  },
  {
    position: 6,
    points: "91",
    wins: "0",
    name: "Lewis Hamilton",
    code: "HAM",
    constructor: "Ferrari",
  },
  {
    position: 7,
    points: "64",
    wins: "0",
    name: "Carlos Sainz",
    code: "SAI",
    constructor: "Williams",
  },
  {
    position: 8,
    points: "52",
    wins: "0",
    name: "Fernando Alonso",
    code: "ALO",
    constructor: "Aston Martin",
  },
];

export const DEMO_GRID: GridSlot[] = [
  { code: "LEC", grid: 1 },
  { code: "NOR", grid: 2 },
  { code: "VER", grid: 3 },
  { code: "PIA", grid: 4 },
  { code: "HAM", grid: 5 },
  { code: "RUS", grid: 6 },
];

export const DEMO_WINNERS: TrackWinner[] = [
  { year: 2025, driver: "Max Verstappen", code: "VER", constructor: "Red Bull Racing" },
  { year: 2024, driver: "Max Verstappen", code: "VER", constructor: "Red Bull Racing" },
  { year: 2023, driver: "Max Verstappen", code: "VER", constructor: "Red Bull Racing" },
  { year: 2022, driver: "Max Verstappen", code: "VER", constructor: "Red Bull Racing" },
  { year: 2019, driver: "Lewis Hamilton", code: "HAM", constructor: "Mercedes" },
];

/** Actual podium for the demo race (matches the round-9 season evaluation). */
export const DEMO_FINAL_TOP3: ActualSlot[] = [
  { position: 1, code: "LEC" },
  { position: 2, code: "NOR" },
  { position: 3, code: "VER" },
];
