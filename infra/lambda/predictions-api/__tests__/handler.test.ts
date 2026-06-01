import { racePK } from "@f1/shared";
import { describe, expect, it, vi } from "vitest";

import {
  getRacePredictions,
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
});
