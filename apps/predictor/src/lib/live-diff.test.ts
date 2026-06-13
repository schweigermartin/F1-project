import { describe, expect, it } from "vitest";

import { diffPredictionVsActual, hitCount } from "./live-diff";

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
