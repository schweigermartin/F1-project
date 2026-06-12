import { describe, expect, it } from "vitest";

import { evalSK, EVALUATION_SK, seasonPK } from "../src/ddb-keys.js";
import {
  RaceEvaluationSchema,
  SEASON_API_SCHEMA_VERSION,
  SeasonEvaluationResponseSchema,
  SessionArchivedDetailSchema,
} from "../src/evaluation-schema.js";

const validEvaluation = {
  race_date: "2026-06-07",
  round: 9,
  season: 2026,
  model_version: "0.2.0",
  n_drivers: 20,
  top3_hit_rate: 2 / 3,
  brier_score: 0.11,
  predicted_top3: [
    { driver_number: 1, driver_code: "VER", podium_probability: 0.81 },
    { driver_number: 4, driver_code: "NOR", podium_probability: 0.74 },
    { driver_number: 16, driver_code: "LEC", podium_probability: 0.52 },
  ],
  actual_top3: [
    { driver_number: 1, driver_code: "VER", position: 1 },
    { driver_number: 81, driver_code: "PIA", position: 2 },
    { driver_number: 4, driver_code: "NOR", position: 3 },
  ],
  evaluated_at: "2026-06-07T16:45:00+00:00",
};

describe("RaceEvaluationSchema", () => {
  it("round-trips a valid evaluation", () => {
    expect(RaceEvaluationSchema.parse(validEvaluation)).toEqual(validEvaluation);
  });

  it("requires exactly three predicted and three actual podium drivers", () => {
    expect(() =>
      RaceEvaluationSchema.parse({
        ...validEvaluation,
        predicted_top3: validEvaluation.predicted_top3.slice(0, 2),
      }),
    ).toThrow();
    expect(() =>
      RaceEvaluationSchema.parse({
        ...validEvaluation,
        actual_top3: [...validEvaluation.actual_top3, validEvaluation.actual_top3[0]],
      }),
    ).toThrow();
  });

  it("rejects metrics outside 0–1", () => {
    expect(() => RaceEvaluationSchema.parse({ ...validEvaluation, top3_hit_rate: 1.1 })).toThrow();
    expect(() => RaceEvaluationSchema.parse({ ...validEvaluation, brier_score: -0.1 })).toThrow();
  });

  it("allows a null driver_code on the actual podium (driver wasn't predicted)", () => {
    const withUnknown = {
      ...validEvaluation,
      actual_top3: [
        { driver_number: 1, driver_code: "VER", position: 1 },
        { driver_number: 99, driver_code: null, position: 2 },
        { driver_number: 4, driver_code: "NOR", position: 3 },
      ],
    };
    expect(RaceEvaluationSchema.parse(withUnknown).actual_top3[1]!.driver_code).toBeNull();
  });

  it("rejects an actual position outside the podium", () => {
    expect(() =>
      RaceEvaluationSchema.parse({
        ...validEvaluation,
        actual_top3: [
          { driver_number: 1, driver_code: "VER", position: 1 },
          { driver_number: 81, driver_code: "PIA", position: 2 },
          { driver_number: 4, driver_code: "NOR", position: 4 },
        ],
      }),
    ).toThrow();
  });
});

describe("SeasonEvaluationResponseSchema", () => {
  it("accepts an empty season (no race evaluated yet — normal state, not an error)", () => {
    const parsed = SeasonEvaluationResponseSchema.parse({
      schema_version: SEASON_API_SCHEMA_VERSION,
      season: 2026,
      races: [],
    });
    expect(parsed.races).toEqual([]);
  });

  it("rejects a stale schema_version (partial-deploy guard)", () => {
    expect(() =>
      SeasonEvaluationResponseSchema.parse({ schema_version: 0, season: 2026, races: [] }),
    ).toThrow();
  });
});

describe("SessionArchivedDetailSchema", () => {
  it("accepts the archiver's event detail", () => {
    expect(SessionArchivedDetailSchema.parse({ date: "2026-06-07", session_id: "12345" })).toEqual({
      date: "2026-06-07",
      session_id: "12345",
    });
  });

  it("rejects a non-ISO date and an empty session id", () => {
    expect(() =>
      SessionArchivedDetailSchema.parse({ date: "07.06.2026", session_id: "12345" }),
    ).toThrow();
    expect(() =>
      SessionArchivedDetailSchema.parse({ date: "2026-06-07", session_id: "" }),
    ).toThrow();
  });
});

describe("F1Predictions evaluation key helpers (Phase 5)", () => {
  it("season PK groups all of a year's evaluations", () => {
    expect(seasonPK(2026)).toBe("season#2026");
  });

  it("eval SK zero-pads the round so a season Query stays sorted", () => {
    expect(evalSK(9)).toBe("eval#09");
    expect(evalSK(22)).toBe("eval#22");
    expect(evalSK(2) < evalSK(10)).toBe(true);
  });

  it("per-race evaluation SK is a fixed literal", () => {
    expect(EVALUATION_SK).toBe("evaluation");
  });
});
