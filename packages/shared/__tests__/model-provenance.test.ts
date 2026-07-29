import { describe, expect, it } from "vitest";

import { MODEL_PROVENANCE, modelProvenance } from "../src/model-provenance.js";

describe("modelProvenance", () => {
  it("reports the training window of the deployed model", () => {
    expect(modelProvenance("0.2.0")).toEqual({
      trainedSeasons: "2022–2025",
      historyThrough: "2025",
    });
  });

  it("returns null for an unknown version rather than guessing", () => {
    // A confidently-stated wrong training window is worse than none — this is
    // what a model shipped without updating the map must produce.
    expect(modelProvenance("0.3.0")).toBeNull();
    expect(modelProvenance("")).toBeNull();
  });

  it("does not resolve inherited Object properties as versions", () => {
    expect(modelProvenance("toString")).toBeNull();
    expect(modelProvenance("constructor")).toBeNull();
  });

  it("documents a history that does not reach the current season", () => {
    // The point of the disclosure: every entry's history stops before 2026, so
    // the rolling form features are prior-season values.
    for (const p of Object.values(MODEL_PROVENANCE)) {
      expect(Number(p.historyThrough)).toBeLessThan(2026);
    }
  });
});
