import { describe, expect, it } from "vitest";

import { diffPredictionVsActual, gridTop3Codes, hitCount } from "./live-diff";

describe("diffPredictionVsActual", () => {
  const predicted = ["VER", "LEC", "NOR"];

  it("marks actual slots that were predicted as hits, sorted by position", () => {
    const rows = diffPredictionVsActual(predicted, [
      { position: 2, code: "VER" },
      { position: 1, code: "LEC" },
      { position: 3, code: "HAM" },
    ]);
    expect(rows.map((r) => [r.position, r.code, r.hit])).toEqual([
      [1, "LEC", true],
      [2, "VER", true],
      [3, "HAM", false],
    ]);
    expect(hitCount(rows)).toBe(2);
  });

  it("treats an unknown (null) code as a miss and caps at three slots", () => {
    const rows = diffPredictionVsActual(predicted, [
      { position: 1, code: null },
      { position: 2, code: "NOR" },
      { position: 3, code: "VER" },
      { position: 4, code: "LEC" },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.hit).toBe(false);
    expect(hitCount(rows)).toBe(2);
  });
});

describe("gridTop3Codes", () => {
  const grid = [
    { code: "NOR", grid: 1 },
    { code: "LEC", grid: 2 },
    { code: "VER", grid: 3 },
    { code: "ANT", grid: 4 },
  ];

  it("returns the three front-row starters in grid order (AC-7)", () => {
    expect(gridTop3Codes(grid)).toEqual(["NOR", "LEC", "VER"]);
  });

  it("sorts by grid position rather than input order", () => {
    expect(gridTop3Codes([...grid].reverse())).toEqual(["NOR", "LEC", "VER"]);
  });

  it("returns an empty list when no grid was loaded", () => {
    expect(gridTop3Codes(null)).toEqual([]);
    expect(gridTop3Codes([])).toEqual([]);
  });

  it("yields what it has when fewer than three drivers are known", () => {
    expect(gridTop3Codes([{ code: "NOR", grid: 1 }])).toEqual(["NOR"]);
  });

  it("ignores rows without a usable grid position", () => {
    expect(
      gridTop3Codes([
        { code: "DNQ", grid: 0 },
        { code: "NAN", grid: Number.NaN },
        { code: "NOR", grid: 1 },
        { code: "LEC", grid: 2 },
      ]),
    ).toEqual(["NOR", "LEC"]);
  });

  it("feeds the shared comparison, so the baseline is scored like the model", () => {
    const actual = [
      { position: 1, code: "NOR" },
      { position: 2, code: "VER" },
      { position: 3, code: "ANT" },
    ];
    expect(hitCount(diffPredictionVsActual(gridTop3Codes(grid), actual))).toBe(2);
  });
});
