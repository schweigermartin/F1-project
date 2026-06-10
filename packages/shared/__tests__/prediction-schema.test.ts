import { describe, expect, it } from "vitest";

import {
  ExplanationItemSchema,
  PODIUM_FEATURE_NAMES,
  PREDICTION_API_SCHEMA_VERSION,
  PredictionApiResponseSchema,
  PredictionItemSchema,
  ShapContributionSchema,
} from "../src/prediction-schema.js";

const validPrediction = {
  driver_number: 1,
  driver_code: "VER",
  podium_probability: 0.68,
  shap_top: [
    { feature: "grid_position", contribution: 0.31 },
    { feature: "driver_form", contribution: -0.12 },
  ],
  model_version: "0.1.0",
  predicted_at: "2026-06-07T13:00:00+00:00",
};

const validExplanation = {
  bedrock_text: "Verstappen startet von der Pole und ist in Topform.",
  model_id: "claude-haiku-4-5-20251001",
  cached_at: "2026-06-07T13:00:05+00:00",
};

describe("PredictionItemSchema", () => {
  it("round-trips a valid prediction item", () => {
    const parsed = PredictionItemSchema.parse(validPrediction);
    expect(parsed).toEqual(validPrediction);
  });

  it("rejects a probability outside 0–1 (AC-5: probabilities come from the model)", () => {
    expect(() =>
      PredictionItemSchema.parse({ ...validPrediction, podium_probability: 1.4 }),
    ).toThrow();
    expect(() =>
      PredictionItemSchema.parse({ ...validPrediction, podium_probability: -0.1 }),
    ).toThrow();
  });

  it("rejects a non-positive driver number", () => {
    expect(() => PredictionItemSchema.parse({ ...validPrediction, driver_number: 0 })).toThrow();
  });
});

describe("ShapContributionSchema", () => {
  it("accepts every known feature name", () => {
    for (const feature of PODIUM_FEATURE_NAMES) {
      expect(() => ShapContributionSchema.parse({ feature, contribution: 0.1 })).not.toThrow();
    }
  });

  it("allows a signed contribution (negative = pushes away from podium)", () => {
    expect(
      ShapContributionSchema.parse({ feature: "is_wet", contribution: -0.9 }).contribution,
    ).toBe(-0.9);
  });

  it("rejects an unknown feature name loudly (drift guard, Constitution VI)", () => {
    expect(() =>
      ShapContributionSchema.parse({ feature: "tyre_temp", contribution: 0.2 }),
    ).toThrow();
  });
});

describe("PODIUM_FEATURE_NAMES", () => {
  it("mirrors the twelve pre-race features in model order (sync with ml/.../schema.py)", () => {
    expect(PODIUM_FEATURE_NAMES).toEqual([
      "grid_position",
      "quali_gap_to_pole_s",
      "driver_form",
      "constructor_form",
      "track_history",
      "is_wet",
      "quali_segment_reached",
      "quali_grid_delta",
      "quali_teammate_gap_s",
      "practice_best_pace_gap_s",
      "practice_long_run_pace_s",
      "practice_laps_count",
    ]);
  });
});

describe("ExplanationItemSchema", () => {
  it("round-trips a cached Bedrock explanation", () => {
    expect(ExplanationItemSchema.parse(validExplanation)).toEqual(validExplanation);
  });
});

describe("PredictionApiResponseSchema", () => {
  it("round-trips a full race response with a null explanation (Begründung folgt)", () => {
    const response = {
      schema_version: PREDICTION_API_SCHEMA_VERSION,
      race_date: "2026-06-07",
      round: 9,
      model_version: "0.1.0",
      drivers: [
        { ...validPrediction, explanation: validExplanation },
        { ...validPrediction, driver_number: 16, driver_code: "LEC", explanation: null },
      ],
    };
    expect(PredictionApiResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects a stale schema_version (partial-deploy guard)", () => {
    expect(() =>
      PredictionApiResponseSchema.parse({
        schema_version: 99,
        race_date: "2026-06-07",
        round: 9,
        model_version: "0.1.0",
        drivers: [],
      }),
    ).toThrow();
  });
});
