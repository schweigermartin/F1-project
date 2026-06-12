import {
  EVALUATION_SK,
  PIPELINE_EVENT_SCHEMA_VERSION,
  type PredictionItem,
  type Session,
} from "@f1/shared";
import { describe, expect, it, vi } from "vitest";

import {
  computeMetrics,
  evaluateArchivedSession,
  type EvaluationDeps,
  finalPositions,
  IncompleteArchiveError,
  predictedTop3,
  raceRound,
  SessionResolutionError,
} from "../handler.js";

const RACE_DATE = "2026-06-07";
const SESSION_ID = "12345";
const DETAIL = { date: RACE_DATE, session_id: SESSION_ID };

function session(overrides: Partial<Session> = {}): Session {
  return {
    session_key: 12345,
    session_type: "Race",
    session_name: "Race",
    date_start: "2026-06-07T13:00:00+00:00",
    date_end: "2026-06-07T15:00:00+00:00",
    meeting_key: 999,
    circuit_key: 1,
    circuit_short_name: "Montreal",
    country_key: 1,
    country_code: "CAN",
    country_name: "Canada",
    location: "Montréal",
    gmt_offset: "-04:00:00",
    year: 2026,
    is_cancelled: false,
    ...overrides,
  };
}

/** A season of three races; ours (12345) starts second → round 2. */
function seasonRaces(): Session[] {
  return [
    session({ session_key: 11111, date_start: "2026-05-24T13:00:00+00:00" }),
    session({ session_key: 12345 }),
    session({ session_key: 22222, date_start: "2026-06-21T13:00:00+00:00" }),
  ];
}

function prediction(driverNumber: number, code: string, p: number): PredictionItem {
  return {
    driver_number: driverNumber,
    driver_code: code,
    podium_probability: p,
    shap_top: [],
    model_version: "0.2.0",
    predicted_at: "2026-06-07T12:00:00+00:00",
  };
}

function predictionDdbItem(driverNumber: number, code: string, p: number): Record<string, unknown> {
  return {
    PK: `race#${RACE_DATE}#02`,
    SK: `prediction#${driverNumber.toString().padStart(2, "0")}`,
    ...prediction(driverNumber, code, p),
  };
}

function positionLine(
  rows: Array<{ driver_number: number; position: number; date: string }>,
  fetchedAt = "2026-06-07T14:59:00.000+00:00",
): string {
  return JSON.stringify({
    session_id: SESSION_ID,
    endpoint: "position",
    payload: rows.map((r) => ({ ...r, session_key: 12345, meeting_key: 999 })),
    fetched_at: fetchedAt,
    schema_version: PIPELINE_EVENT_SCHEMA_VERSION,
  });
}

/** Final order: 1=VER(1), 2=PIA(81), 3=NOR(4), 4=LEC(16). */
function archiveText(): string {
  return [
    positionLine(
      [
        { driver_number: 4, position: 2, date: "2026-06-07T14:00:00+00:00" },
        { driver_number: 81, position: 3, date: "2026-06-07T14:00:00+00:00" },
      ],
      "2026-06-07T14:00:01.000+00:00",
    ),
    JSON.stringify({
      session_id: SESSION_ID,
      endpoint: "laps",
      payload: [],
      fetched_at: "2026-06-07T14:30:00.000+00:00",
      schema_version: PIPELINE_EVENT_SCHEMA_VERSION,
    }),
    "not json at all",
    positionLine([
      { driver_number: 1, position: 1, date: "2026-06-07T14:58:00+00:00" },
      { driver_number: 81, position: 2, date: "2026-06-07T14:58:00+00:00" },
      { driver_number: 4, position: 3, date: "2026-06-07T14:58:00+00:00" },
      { driver_number: 16, position: 4, date: "2026-06-07T14:58:00+00:00" },
    ]),
  ].join("\n");
}

function makeDeps(overrides: Partial<EvaluationDeps> = {}): {
  deps: EvaluationDeps;
  putItem: ReturnType<typeof vi.fn>;
  emitMetric: ReturnType<typeof vi.fn>;
} {
  const putItem = vi.fn(async (_item: Record<string, unknown>) => {});
  const emitMetric = vi.fn();
  const deps: EvaluationDeps = {
    fetchSessionByKey: async () => [session()],
    fetchSeasonRaces: async () => seasonRaces(),
    getArchiveText: async () => archiveText(),
    queryRace: async () => [
      predictionDdbItem(1, "VER", 0.81),
      predictionDdbItem(4, "NOR", 0.74),
      predictionDdbItem(16, "LEC", 0.52),
      predictionDdbItem(81, "PIA", 0.4),
    ],
    putItem,
    now: () => new Date("2026-06-07T16:45:00.000Z"),
    emitMetric,
    ...overrides,
  };
  return { deps, putItem, emitMetric };
}

describe("raceRound", () => {
  it("is the 1-based position among the season's races by start date", () => {
    expect(raceRound(session(), seasonRaces())).toBe(2);
  });

  it("returns 0 for a race missing from the season list", () => {
    expect(raceRound(session({ session_key: 777 }), seasonRaces())).toBe(0);
  });

  it("skips cancelled races — official numbering (and the prediction PK) does too", () => {
    // 2026 regression: two cancelled spring races would otherwise shift every
    // later round by two and orphan the predictions written by schedule-sync.
    const withCancelled = [
      session({ session_key: 100, date_start: "2026-03-08T13:00:00+00:00" }),
      session({ session_key: 101, date_start: "2026-04-12T13:00:00+00:00", is_cancelled: true }),
      session({ session_key: 102, date_start: "2026-04-19T13:00:00+00:00", is_cancelled: true }),
      session(), // 12345, 2026-06-07
    ];
    expect(raceRound(session(), withCancelled)).toBe(2);
  });
});

describe("finalPositions", () => {
  it("keeps the latest row per driver by the row's own date", () => {
    const positions = finalPositions(archiveText());
    expect(positions.get(81)!.position).toBe(2); // earlier tick said 3
    expect(positions.get(1)!.position).toBe(1);
    expect(positions.size).toBe(4);
  });

  it("ignores non-position endpoints and unparseable lines", () => {
    const onlyJunk = ["not json", JSON.stringify({ wrong: "shape" })].join("\n");
    expect(finalPositions(onlyJunk).size).toBe(0);
  });

  it("fails loudly when a position payload drifts from the schema", () => {
    const drifted = JSON.stringify({
      session_id: SESSION_ID,
      endpoint: "position",
      payload: [{ driver_number: "one", position: 1 }],
      fetched_at: "2026-06-07T14:00:00.000+00:00",
      schema_version: PIPELINE_EVENT_SCHEMA_VERSION,
    });
    expect(() => finalPositions(drifted)).toThrow();
  });
});

describe("predictedTop3 + computeMetrics", () => {
  const grid = [
    prediction(1, "VER", 0.81),
    prediction(4, "NOR", 0.74),
    prediction(16, "LEC", 0.52),
    prediction(81, "PIA", 0.4),
  ];

  it("picks the three highest probabilities", () => {
    expect(predictedTop3(grid).map((p) => p.driver_number)).toEqual([1, 4, 16]);
  });

  it("breaks probability ties by driver number for deterministic re-runs", () => {
    const tied = [prediction(44, "HAM", 0.5), prediction(4, "NOR", 0.5), prediction(1, "VER", 0.9)];
    expect(predictedTop3(tied).map((p) => p.driver_number)).toEqual([1, 4, 44]);
  });

  it("hit rate counts the overlap with the actual podium", () => {
    // Actual: 1, 81, 4 → predicted 1, 4, 16 hits two of three.
    expect(computeMetrics(grid, new Set([1, 81, 4])).top3_hit_rate).toBeCloseTo(2 / 3);
    expect(computeMetrics(grid, new Set([1, 4, 16])).top3_hit_rate).toBe(1);
    expect(computeMetrics(grid, new Set([10, 11, 12])).top3_hit_rate).toBe(0);
  });

  it("brier is the mean squared error over all predicted drivers", () => {
    const actual = new Set([1, 81, 4]);
    const expected = ((0.81 - 1) ** 2 + (0.74 - 1) ** 2 + (0.52 - 0) ** 2 + (0.4 - 1) ** 2) / 4;
    expect(computeMetrics(grid, actual).brier_score).toBeCloseTo(expected);
  });

  it("perfect confident prediction scores 0, confident miss scores high", () => {
    const confident = [prediction(1, "VER", 1), prediction(4, "NOR", 1), prediction(16, "LEC", 1)];
    expect(computeMetrics(confident, new Set([1, 4, 16])).brier_score).toBe(0);
    expect(computeMetrics(confident, new Set([7, 8, 9])).brier_score).toBe(1);
  });
});

describe("evaluateArchivedSession", () => {
  it("scores a race and writes the same payload under the race and season PKs", async () => {
    const { deps, putItem, emitMetric } = makeDeps();
    const result = await evaluateArchivedSession(DETAIL, deps);

    if (!("evaluation" in result)) throw new Error("expected an evaluation");
    expect(result.evaluation).toMatchObject({
      race_date: RACE_DATE,
      round: 2,
      season: 2026,
      model_version: "0.2.0",
      n_drivers: 4,
      top3_hit_rate: 2 / 3,
    });
    expect(result.evaluation.predicted_top3.map((p) => p.driver_code)).toEqual([
      "VER",
      "NOR",
      "LEC",
    ]);
    expect(result.evaluation.actual_top3).toEqual([
      { driver_number: 1, driver_code: "VER", position: 1 },
      { driver_number: 81, driver_code: "PIA", position: 2 },
      { driver_number: 4, driver_code: "NOR", position: 3 },
    ]);

    expect(putItem).toHaveBeenCalledTimes(2);
    const keys = putItem.mock.calls.map((c) => {
      const item = c[0] as Record<string, unknown>;
      return { PK: item["PK"], SK: item["SK"] };
    });
    expect(keys).toContainEqual({ PK: `race#${RACE_DATE}#02`, SK: EVALUATION_SK });
    expect(keys).toContainEqual({ PK: "season#2026", SK: "eval#02" });
    // Identical payload under both keys (D-4) — only the keys differ.
    const stripKeys = (i: Record<string, unknown>): Record<string, unknown> => {
      const { PK: _pk, SK: _sk, ...rest } = i;
      return rest;
    };
    expect(stripKeys(putItem.mock.calls[0]![0] as Record<string, unknown>)).toEqual(
      stripKeys(putItem.mock.calls[1]![0] as Record<string, unknown>),
    );
    expect(emitMetric).toHaveBeenCalledWith("EvaluationHitRate", 2 / 3);
  });

  it("skips non-race sessions (sprints, quali, practice) with a metric", async () => {
    const { deps, putItem, emitMetric } = makeDeps({
      fetchSessionByKey: async () => [session({ session_name: "Sprint" })],
    });
    const result = await evaluateArchivedSession(DETAIL, deps);
    expect(result).toEqual({ skipped: "not-race", session_name: "Sprint" });
    expect(putItem).not.toHaveBeenCalled();
    expect(emitMetric).toHaveBeenCalledWith("EvaluationSkippedNotRace", 1);
  });

  it("skips a race without predictions (R-4) with a metric, not an error", async () => {
    const { deps, putItem, emitMetric } = makeDeps({ queryRace: async () => [] });
    const result = await evaluateArchivedSession(DETAIL, deps);
    expect(result).toEqual({ skipped: "no-predictions", race_date: RACE_DATE, round: 2 });
    expect(putItem).not.toHaveBeenCalled();
    expect(emitMetric).toHaveBeenCalledWith("EvaluationSkippedNoPredictions", 1);
  });

  it("ignores explanation/evaluation rows when collecting predictions", async () => {
    const { deps } = makeDeps({
      queryRace: async () => [
        predictionDdbItem(1, "VER", 0.81),
        predictionDdbItem(4, "NOR", 0.74),
        predictionDdbItem(16, "LEC", 0.52),
        { PK: `race#${RACE_DATE}#02`, SK: "explanation#01", bedrock_text: "…" },
        { PK: `race#${RACE_DATE}#02`, SK: EVALUATION_SK, top3_hit_rate: 1 },
      ],
    });
    const result = await evaluateArchivedSession(DETAIL, deps);
    if (!("evaluation" in result)) throw new Error("expected an evaluation");
    expect(result.evaluation.n_drivers).toBe(3);
  });

  it("fails loudly when the archive has fewer than 3 drivers with positions (R-3)", async () => {
    const thin = positionLine([
      { driver_number: 1, position: 1, date: "2026-06-07T14:58:00+00:00" },
    ]);
    const { deps } = makeDeps({ getArchiveText: async () => thin });
    await expect(evaluateArchivedSession(DETAIL, deps)).rejects.toThrow(IncompleteArchiveError);
  });

  it("fails loudly when positions exist but the podium is incomplete (R-3)", async () => {
    // Positions 1, 4, 5, 6 — three drivers short of a full podium.
    const noPodium = positionLine([
      { driver_number: 1, position: 1, date: "2026-06-07T14:58:00+00:00" },
      { driver_number: 4, position: 4, date: "2026-06-07T14:58:00+00:00" },
      { driver_number: 16, position: 5, date: "2026-06-07T14:58:00+00:00" },
      { driver_number: 81, position: 6, date: "2026-06-07T14:58:00+00:00" },
    ]);
    const { deps } = makeDeps({ getArchiveText: async () => noPodium });
    await expect(evaluateArchivedSession(DETAIL, deps)).rejects.toThrow(IncompleteArchiveError);
  });

  it("fails loudly when the session_key doesn't resolve via OpenF1", async () => {
    const { deps } = makeDeps({ fetchSessionByKey: async () => [] });
    await expect(evaluateArchivedSession(DETAIL, deps)).rejects.toThrow(SessionResolutionError);
  });

  it("fails loudly when the race is missing from the season's race list", async () => {
    const { deps } = makeDeps({
      fetchSeasonRaces: async () => [session({ session_key: 11111 })],
    });
    await expect(evaluateArchivedSession(DETAIL, deps)).rejects.toThrow(SessionResolutionError);
  });

  it("rejects a malformed event detail", async () => {
    const { deps } = makeDeps();
    await expect(evaluateArchivedSession({ date: "07.06.2026" }, deps)).rejects.toThrow();
  });

  it("marks an actual podium driver without a prediction with a null code", async () => {
    // Driver 99 finishes P2 but was never predicted.
    const withOutsider = positionLine([
      { driver_number: 1, position: 1, date: "2026-06-07T14:58:00+00:00" },
      { driver_number: 99, position: 2, date: "2026-06-07T14:58:00+00:00" },
      { driver_number: 4, position: 3, date: "2026-06-07T14:58:00+00:00" },
    ]);
    const { deps } = makeDeps({ getArchiveText: async () => withOutsider });
    const result = await evaluateArchivedSession(DETAIL, deps);
    if (!("evaluation" in result)) throw new Error("expected an evaluation");
    expect(result.evaluation.actual_top3[1]).toEqual({
      driver_number: 99,
      driver_code: null,
      position: 2,
    });
  });
});
