import { describe, expect, it } from "vitest";

import { DIAGRAM, EDGES, MODEL_FEATURES, NODES } from "./architecture-data";
import { edgeGeometry, edgePathId, incidentEdges, nodeById } from "./architecture-geometry";

describe("architecture graph integrity", () => {
  it("every edge references existing nodes", () => {
    for (const e of EDGES) {
      expect(nodeById(e.from), `from: ${e.from}`).toBeDefined();
      expect(nodeById(e.to), `to: ${e.to}`).toBeDefined();
    }
  });

  it("has unique node ids", () => {
    const ids = NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every node fully inside the viewBox", () => {
    for (const n of NODES) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + DIAGRAM.nodeW).toBeLessThanOrEqual(DIAGRAM.width);
      expect(n.y + DIAGRAM.nodeH).toBeLessThanOrEqual(DIAGRAM.height);
    }
  });
});

describe("edgeGeometry", () => {
  it("produces endpoints on the node borders within the viewBox", () => {
    for (const e of EDGES) {
      const g = edgeGeometry(e);
      for (const v of [g.x1, g.x2]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(DIAGRAM.width);
      }
      for (const v of [g.y1, g.y2]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(DIAGRAM.height);
      }
      expect(g.d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    }
  });

  it("throws on an unknown node", () => {
    expect(() => edgeGeometry({ from: "nope", to: "openf1", dur: 1 })).toThrow(/unknown node/);
  });

  it("derives a stable, unique path id per edge", () => {
    const ids = EDGES.map(edgePathId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("incidentEdges", () => {
  it("returns only edges touching the node", () => {
    const edges = incidentEdges("poller");
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(e.from === "poller" || e.to === "poller").toBe(true);
  });
});

describe("model features", () => {
  // The bars are sorted by SHAP importance, so check the SET (not order) covers
  // exactly the 6 FEATURE_NAMES from ml/src/f1pred/schema.py — no invented features.
  it("covers exactly the 6 real model features", () => {
    expect(new Set(MODEL_FEATURES.map((f) => f.name))).toEqual(
      new Set([
        "grid_position",
        "quali_gap_to_pole_s",
        "driver_form",
        "constructor_form",
        "track_history",
        "is_wet",
      ]),
    );
  });

  it("lists features in descending SHAP importance", () => {
    const imps = MODEL_FEATURES.map((f) => f.importance);
    expect([...imps].sort((a, b) => b - a)).toEqual(imps);
  });
});
