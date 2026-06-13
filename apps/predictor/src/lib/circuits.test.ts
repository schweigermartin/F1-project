import { describe, expect, it } from "vitest";

import { featureCoords, matchCircuitFeature, projectToSvg, type LonLat } from "./circuits";

describe("projectToSvg", () => {
  it("fits a square loop into the padded viewBox with latitude flipped", () => {
    // Unit square in lon/lat. North (max lat) must map to the smaller y.
    const square: LonLat[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const path = projectToSvg(square, 100, 10);
    expect(path).not.toBeNull();
    expect(path?.viewBox).toBe("0 0 100 100");
    // First point (lon 0, lat 0) is the south-west corner → bottom-left:
    // x at the left pad, y near the bottom (large).
    expect(path?.start.x).toBeCloseTo(10, 1);
    expect(path?.start.y).toBeCloseTo(90, 1);
    expect(path?.d.startsWith("M")).toBe(true);
    expect(path?.d.endsWith("Z")).toBe(true);
  });

  it("preserves aspect ratio (a wide track is not stretched vertically)", () => {
    const wide: LonLat[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [0, 1],
      [0, 0],
    ];
    const path = projectToSvg(wide, 100, 0);
    // span 4 wide × 1 tall → scale 25; height used = 25, centered vertically.
    // Top edge y ≈ (100-25)/2 = 37.5, bottom ≈ 62.5.
    // Tokens: ["M0.00","62.50","L100.00","62.50",...]; y-values sit at odd indices.
    const tokens = (path?.d ?? "").replace(/[ML]/g, "").replace(/Z$/, "").trim().split(/\s+/);
    const ys = tokens.filter((_, i) => i % 2 === 1).map(Number);
    expect(Math.min(...ys)).toBeGreaterThan(35);
    expect(Math.max(...ys)).toBeLessThan(65);
  });

  it("returns null for degenerate input", () => {
    expect(projectToSvg([], 100)).toBeNull();
    expect(projectToSvg([[0, 0]], 100)).toBeNull();
  });
});

describe("featureCoords", () => {
  it("picks the longest segment of a MultiLineString", () => {
    const feature = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "MultiLineString" as const,
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
          [
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3],
          ],
        ],
      },
    } as Parameters<typeof featureCoords>[0];
    expect(featureCoords(feature)).toHaveLength(4);
  });
});

describe("matchCircuitFeature", () => {
  const features = [
    { type: "Feature" as const, properties: { name: "Circuit Gilles Villeneuve", Location: "Montreal" }, geometry: { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] } },
    { type: "Feature" as const, properties: { name: "Silverstone Circuit", Location: "Silverstone" }, geometry: { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] } },
  ] as Parameters<typeof matchCircuitFeature>[0];

  it("matches on circuit name keyword", () => {
    const m = matchCircuitFeature(features, { circuit: "Circuit Gilles Villeneuve" });
    expect(m?.properties.Location).toBe("Montreal");
  });

  it("matches on locality when name differs", () => {
    const m = matchCircuitFeature(features, { circuit: "British GP Track", locality: "Silverstone" });
    expect(m?.properties.name).toBe("Silverstone Circuit");
  });

  it("returns null when nothing matches", () => {
    expect(matchCircuitFeature(features, { circuit: "Monaco", locality: "Monte Carlo" })).toBeNull();
  });
});
