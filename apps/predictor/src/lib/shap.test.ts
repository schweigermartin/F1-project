import { describe, expect, it } from "vitest";

import { buildWaterfall, FEATURE_LABELS } from "./shap";

describe("buildWaterfall", () => {
  it("walks a running total and tracks the value-space domain", () => {
    const wf = buildWaterfall([
      { feature: "grid_position", contribution: 0.4 },
      { feature: "driver_form", contribution: -0.1 },
      { feature: "constructor_form", contribution: 0.2 },
    ]);
    const ends = wf.bars.map((b) => b.end);
    expect(ends[0]).toBeCloseTo(0.4, 6);
    expect(ends[1]).toBeCloseTo(0.3, 6);
    expect(ends[2]).toBeCloseTo(0.5, 6);
    // Each bar starts where the previous ended.
    expect(wf.bars[1]?.start).toBeCloseTo(0.4, 6);
    expect(wf.bars[2]?.start).toBeCloseTo(0.3, 6);
    expect(wf.min).toBe(0); // baseline
    expect(wf.max).toBeCloseTo(0.5, 6);
  });

  it("labels features in German and preserves input order", () => {
    const wf = buildWaterfall([
      { feature: "quali_teammate_gap_s", contribution: 0.1 },
      { feature: "is_wet", contribution: -0.05 },
    ]);
    expect(wf.bars.map((b) => b.label)).toEqual([
      FEATURE_LABELS.quali_teammate_gap_s,
      FEATURE_LABELS.is_wet,
    ]);
  });

  it("handles an empty contribution list", () => {
    const wf = buildWaterfall([]);
    expect(wf.bars).toEqual([]);
    expect(wf.min).toBe(0);
    expect(wf.max).toBe(0);
  });
});
