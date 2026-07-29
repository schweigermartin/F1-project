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

  it("reports the refreshed history of 0.2.1 (Phase 010)", () => {
    // Same fitted model as 0.2.0 — only the history moved on, which is the
    // whole reason the two fields are tracked separately.
    expect(modelProvenance("0.2.1")).toEqual({
      trainedSeasons: "2022–2025",
      historyThrough: "2026",
    });
    expect(modelProvenance("0.2.0")?.trainedSeasons).toBe(modelProvenance("0.2.1")?.trainedSeasons);
  });

  it("keeps each version pinned to the history that produced its predictions", () => {
    // Rounds 1–11 of 2026 were predicted under 0.2.0 and are still served from
    // DynamoDB with that version. If this ever reported 2026 for 0.2.0 the UI
    // would overstate what those archived predictions actually saw.
    expect(modelProvenance("0.2.0")?.historyThrough).toBe("2025");
  });

  it("never claims a history that reaches beyond its training window without saying so", () => {
    // A history may legitimately extend past the training seasons (0.2.1 does).
    // What must never happen is the reverse — a history ending before the last
    // season the model was fitted on would mean the artifact is incomplete.
    for (const p of Object.values(MODEL_PROVENANCE)) {
      const lastTrained = Number(p.trainedSeasons.split("–").at(-1));
      expect(Number(p.historyThrough)).toBeGreaterThanOrEqual(lastTrained);
    }
  });
});
