import { describe, expect, it } from "vitest";

import {
  effectivePodiumProbability,
  normalizePodiumProbabilities,
  PODIUM_SLOTS,
} from "../src/podium-normalize.js";

/**
 * A representative 19-driver field: the leading probabilities are the ones
 * measured on the live Read-API for round 10 (Spa), the tail is filled in
 * plausibly. Its sum (~5.3) sits in the range measured across rounds 8–11
 * (4.94–5.83) — the point of the fixture is the over-allocation, not an exact
 * reproduction of one race.
 */
const OVER_ALLOCATED_FIELD = [
  0.93, 0.9, 0.79, 0.62, 0.55, 0.41, 0.28, 0.21, 0.16, 0.12, 0.09, 0.07, 0.05, 0.04, 0.03, 0.02,
  0.015, 0.01, 0.005,
];

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe("normalizePodiumProbabilities", () => {
  it("makes an over-allocated field sum to three (AC-1)", () => {
    // The raw model output is far over-allocated — that is the bug being fixed.
    expect(sum(OVER_ALLOCATED_FIELD)).toBeGreaterThan(4.9);
    expect(sum(normalizePodiumProbabilities(OVER_ALLOCATED_FIELD))).toBeCloseTo(PODIUM_SLOTS, 2);
  });

  it("preserves the exact ranking (AC-2)", () => {
    const raw = [0.4, 0.9, 0.1, 0.75, 0.6];
    const normalized = normalizePodiumProbabilities(raw);

    const orderOf = (xs: number[]): number[] =>
      xs.map((_, i) => i).sort((a, b) => xs[b]! - xs[a]!);
    expect(orderOf(normalized)).toEqual(orderOf(raw));
  });

  it("keeps every value inside [0, 1] even for a dominant field (AC-3)", () => {
    // Proportional scaling would give 0.99 * 3/2.02 = 1.47 here.
    const dominant = [0.99, 0.98, 0.02, 0.01, 0.005, 0.005];
    for (const p of normalizePodiumProbabilities(dominant)) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(sum(normalizePodiumProbabilities(dominant))).toBeCloseTo(PODIUM_SLOTS, 2);
  });

  it("is idempotent — normalising twice equals normalising once", () => {
    const once = normalizePodiumProbabilities(OVER_ALLOCATED_FIELD);
    const twice = normalizePodiumProbabilities(once);
    for (const [i, value] of once.entries()) {
      expect(twice[i]).toBeCloseTo(value, 6);
    }
  });

  it("spreads the slots evenly when every driver is equal", () => {
    const equal = normalizePodiumProbabilities([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    for (const p of equal) expect(p).toBeCloseTo(PODIUM_SLOTS / 6, 6);
  });

  it("leaves an already-correct field essentially untouched", () => {
    const correct = [0.9, 0.8, 0.7, 0.3, 0.2, 0.1];
    expect(sum(correct)).toBeCloseTo(PODIUM_SLOTS, 6);
    const normalized = normalizePodiumProbabilities(correct);
    for (const [i, value] of correct.entries()) {
      expect(normalized[i]).toBeCloseTo(value, 4);
    }
  });

  it("honours a custom slot count", () => {
    expect(sum(normalizePodiumProbabilities(OVER_ALLOCATED_FIELD, 1))).toBeCloseTo(1, 2);
    expect(sum(normalizePodiumProbabilities(OVER_ALLOCATED_FIELD, 10))).toBeCloseTo(10, 2);
  });

  describe("edge cases (plan §2.3)", () => {
    it("returns an empty array for an empty field", () => {
      expect(normalizePodiumProbabilities([])).toEqual([]);
    });

    it("saturates to 1 when there are no more drivers than slots", () => {
      // With three drivers everyone finishes on the podium; the sum cannot
      // reach three by shifting, so 1.0 is the correct answer.
      expect(normalizePodiumProbabilities([0.9, 0.2, 0.05])).toEqual([1, 1, 1]);
      expect(normalizePodiumProbabilities([0.4])).toEqual([1]);
    });

    it("handles probabilities of exactly 0 and 1 without producing NaN", () => {
      const normalized = normalizePodiumProbabilities([1, 1, 1, 0, 0, 0]);
      for (const p of normalized) expect(Number.isFinite(p)).toBe(true);
      expect(sum(normalized)).toBeCloseTo(PODIUM_SLOTS, 2);
    });

    it("handles an all-zero field", () => {
      const normalized = normalizePodiumProbabilities([0, 0, 0, 0, 0, 0]);
      for (const p of normalized) expect(Number.isFinite(p)).toBe(true);
      expect(sum(normalized)).toBeCloseTo(PODIUM_SLOTS, 2);
    });

    it("handles an all-one field", () => {
      const normalized = normalizePodiumProbabilities([1, 1, 1, 1, 1, 1]);
      for (const p of normalized) expect(Number.isFinite(p)).toBe(true);
      expect(sum(normalized)).toBeCloseTo(PODIUM_SLOTS, 2);
    });

    it("does not produce NaN for a non-finite input", () => {
      const normalized = normalizePodiumProbabilities([Number.NaN, 0.5, 0.5, 0.5, 0.5]);
      for (const p of normalized) expect(Number.isFinite(p)).toBe(true);
    });
  });
});

describe("effectivePodiumProbability", () => {
  it("prefers the normalised value when present", () => {
    expect(
      effectivePodiumProbability({ podium_probability: 0.9, podium_probability_normalized: 0.42 }),
    ).toBe(0.42);
  });

  it("falls back to the raw value when the API predates the field (AC-5)", () => {
    expect(effectivePodiumProbability({ podium_probability: 0.9 })).toBe(0.9);
    expect(
      effectivePodiumProbability({
        podium_probability: 0.9,
        podium_probability_normalized: undefined,
      }),
    ).toBe(0.9);
  });

  it("keeps a normalised zero rather than treating it as absent", () => {
    expect(
      effectivePodiumProbability({ podium_probability: 0.9, podium_probability_normalized: 0 }),
    ).toBe(0);
  });
});
