import { evalSK, EVALUATION_SK, racePK, seasonPK } from "@f1/shared";
import { describe, expect, it, vi } from "vitest";

import {
  getRacePredictions,
  getSeasonEvaluations,
  InvalidQueryError,
  RaceNotFoundError,
  type ReadApiDeps,
} from "../handler.js";

const RACE_DATE = "2026-06-07";
const ROUND = 7;

function predictionRow(n: number, code: string, prob: number): Record<string, unknown> {
  return {
    PK: racePK(RACE_DATE, ROUND),
    SK: `prediction#${n.toString().padStart(2, "0")}`,
    driver_number: n,
    driver_code: code,
    podium_probability: prob,
    shap_top: [{ feature: "grid_position", contribution: -0.42 }],
    model_version: "0.1.0",
    predicted_at: "2026-06-07T13:00:00+00:00",
  };
}

function explanationRow(n: number): Record<string, unknown> {
  return {
    PK: racePK(RACE_DATE, ROUND),
    SK: `explanation#${n.toString().padStart(2, "0")}`,
    bedrock_text: `Fahrer ${n} hat gute Chancen.`,
    model_id: "claude-haiku-4-5-20251001",
    cached_at: "2026-06-07T13:00:05+00:00",
  };
}

function makeDeps(items: Record<string, unknown>[]): {
  deps: ReadApiDeps;
  queryRace: ReturnType<typeof vi.fn>;
} {
  const queryRace = vi.fn(async () => items);
  return { deps: { queryRace }, queryRace };
}

describe("getRacePredictions", () => {
  it("merges each driver's prediction with its explanation", async () => {
    const { deps, queryRace } = makeDeps([
      predictionRow(1, "VER", 0.82),
      explanationRow(1),
      predictionRow(16, "LEC", 0.55),
      explanationRow(16),
    ]);

    const res = await getRacePredictions({ race_date: RACE_DATE, round: "7" }, deps);

    expect(queryRace).toHaveBeenCalledWith(racePK(RACE_DATE, ROUND));
    expect(res.schema_version).toBe(1);
    expect(res.race_date).toBe(RACE_DATE);
    expect(res.round).toBe(ROUND);
    expect(res.model_version).toBe("0.1.0");
    expect(res.drivers).toHaveLength(2);
    const ver = res.drivers.find((d) => d.driver_number === 1)!;
    expect(ver.driver_code).toBe("VER");
    expect(ver.explanation?.bedrock_text).toContain("Fahrer 1");
  });

  it("leaves explanation null when Bedrock hasn't produced one yet", async () => {
    const { deps } = makeDeps([predictionRow(44, "HAM", 0.4)]);
    const res = await getRacePredictions({ race_date: RACE_DATE, round: "7" }, deps);
    expect(res.drivers).toHaveLength(1);
    expect(res.drivers[0]!.explanation).toBeNull();
  });

  it("ignores rows that are neither prediction nor explanation", async () => {
    const { deps } = makeDeps([
      { PK: racePK(RACE_DATE, ROUND), SK: "meta#run", note: "bookkeeping" },
      predictionRow(1, "VER", 0.9),
    ]);
    const res = await getRacePredictions({ race_date: RACE_DATE, round: "7" }, deps);
    expect(res.drivers).toHaveLength(1);
  });

  it("throws RaceNotFoundError when the race has no predictions", async () => {
    const { deps } = makeDeps([]);
    await expect(
      getRacePredictions({ race_date: RACE_DATE, round: "7" }, deps),
    ).rejects.toBeInstanceOf(RaceNotFoundError);
  });

  it("throws InvalidQueryError on a malformed date", async () => {
    const { deps } = makeDeps([]);
    await expect(
      getRacePredictions({ race_date: "07/06/2026", round: "7" }, deps),
    ).rejects.toBeInstanceOf(InvalidQueryError);
  });

  it("throws InvalidQueryError when round is missing", async () => {
    const { deps } = makeDeps([]);
    await expect(getRacePredictions({ race_date: RACE_DATE }, deps)).rejects.toBeInstanceOf(
      InvalidQueryError,
    );
  });

  it("emits a PredictionsServed metric with the driver count", async () => {
    const emitMetric = vi.fn();
    const { deps } = makeDeps([predictionRow(1, "VER", 0.9), predictionRow(16, "LEC", 0.5)]);
    await getRacePredictions({ race_date: RACE_DATE, round: "7" }, { ...deps, emitMetric });
    expect(emitMetric).toHaveBeenCalledWith("PredictionsServed", 2);
  });

  it("ignores the Phase-5 evaluation row (regression — race mode unchanged)", async () => {
    const { deps } = makeDeps([
      predictionRow(1, "VER", 0.9),
      { PK: racePK(RACE_DATE, ROUND), SK: EVALUATION_SK, top3_hit_rate: 1 },
    ]);
    const res = await getRacePredictions({ race_date: RACE_DATE, round: "7" }, deps);
    expect(res.drivers).toHaveLength(1);
  });
});

function evaluationRow(round: number, hitRate: number): Record<string, unknown> {
  return {
    PK: seasonPK(2026),
    SK: evalSK(round),
    race_date: "2026-06-07",
    round,
    season: 2026,
    model_version: "0.2.0",
    n_drivers: 20,
    top3_hit_rate: hitRate,
    brier_score: 0.12,
    predicted_top3: [
      { driver_number: 1, driver_code: "VER", podium_probability: 0.8 },
      { driver_number: 4, driver_code: "NOR", podium_probability: 0.7 },
      { driver_number: 16, driver_code: "LEC", podium_probability: 0.5 },
    ],
    actual_top3: [
      { driver_number: 1, driver_code: "VER", position: 1 },
      { driver_number: 81, driver_code: null, position: 2 },
      { driver_number: 4, driver_code: "NOR", position: 3 },
    ],
    evaluated_at: "2026-06-07T16:45:00+00:00",
  };
}

describe("getSeasonEvaluations (Phase 5)", () => {
  it("returns the season's evaluations sorted by round", async () => {
    const { deps, queryRace } = makeDeps([evaluationRow(9, 1), evaluationRow(2, 1 / 3)]);
    const res = await getSeasonEvaluations({ season: "2026" }, deps);
    expect(queryRace).toHaveBeenCalledWith(seasonPK(2026));
    expect(res.schema_version).toBe(1);
    expect(res.season).toBe(2026);
    expect(res.races.map((r) => r.round)).toEqual([2, 9]);
  });

  it("returns an empty races array for a season without evaluations (200, not 404)", async () => {
    const { deps } = makeDeps([]);
    const res = await getSeasonEvaluations({ season: "2026" }, deps);
    expect(res.races).toEqual([]);
  });

  it("throws InvalidQueryError on a non-year season", async () => {
    const { deps } = makeDeps([]);
    await expect(getSeasonEvaluations({ season: "soon" }, deps)).rejects.toBeInstanceOf(
      InvalidQueryError,
    );
  });

  it("fails loudly when a stored evaluation row drifted from the schema", async () => {
    const drifted = { ...evaluationRow(2, 0.5), brier_score: "low" };
    const { deps } = makeDeps([drifted]);
    await expect(getSeasonEvaluations({ season: "2026" }, deps)).rejects.toThrow();
  });

  it("emits an EvaluationsServed metric with the race count", async () => {
    const emitMetric = vi.fn();
    const { deps } = makeDeps([evaluationRow(2, 1)]);
    await getSeasonEvaluations({ season: "2026" }, { ...deps, emitMetric });
    expect(emitMetric).toHaveBeenCalledWith("EvaluationsServed", 1);
  });
});
