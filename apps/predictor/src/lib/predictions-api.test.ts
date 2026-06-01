import type { PredictionWithExplanation } from "@f1/shared";
import { describe, expect, it } from "vitest";

import { sortByPodium } from "./predictions-api";

function driver(n: number, prob: number): PredictionWithExplanation {
  return {
    driver_number: n,
    driver_code: `D${n}`,
    podium_probability: prob,
    shap_top: [],
    model_version: "0.1.0",
    predicted_at: "2026-06-07T13:00:00+00:00",
    explanation: null,
  };
}

describe("sortByPodium", () => {
  it("orders drivers by descending podium probability (US-1)", () => {
    const sorted = sortByPodium([driver(1, 0.2), driver(16, 0.81), driver(44, 0.5)]);
    expect(sorted.map((d) => d.driver_number)).toEqual([16, 44, 1]);
  });

  it("does not mutate the input array", () => {
    const input = [driver(1, 0.2), driver(16, 0.81)];
    sortByPodium(input);
    expect(input.map((d) => d.driver_number)).toEqual([1, 16]);
  });
});
