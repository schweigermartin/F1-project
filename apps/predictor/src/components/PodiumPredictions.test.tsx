import type { PredictionApiResponse } from "@f1/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PodiumPredictions } from "./PodiumPredictions";

afterEach(cleanup);

const RESPONSE: PredictionApiResponse = {
  schema_version: 1,
  race_date: "2026-06-07",
  round: 3,
  model_version: "0.1.0",
  drivers: [
    // Deliberately NOT in podium order — the component must sort them.
    {
      driver_number: 1,
      driver_code: "VER",
      podium_probability: 0.41,
      shap_top: [{ feature: "grid_position", contribution: -0.3 }],
      model_version: "0.1.0",
      predicted_at: "2026-06-07T13:00:00+00:00",
      explanation: {
        bedrock_text: "Verstappen startet stark, aber von P4.",
        model_id: "claude-haiku-4-5",
        cached_at: "2026-06-07T13:00:05+00:00",
      },
    },
    {
      driver_number: 16,
      driver_code: "LEC",
      podium_probability: 0.88,
      shap_top: [],
      model_version: "0.1.0",
      predicted_at: "2026-06-07T13:00:00+00:00",
      explanation: null,
    },
  ],
};

describe("PodiumPredictions", () => {
  it("renders drivers as bars sorted by podium probability descending (US-1)", () => {
    render(<PodiumPredictions response={RESPONSE} raceName="Canada" raceDate="2026-06-07" />);
    const rows = screen.getAllByRole("button");
    // LEC (0.88) must come before VER (0.41) regardless of input order.
    expect(rows[0]?.textContent).toContain("LEC");
    expect(rows[1]?.textContent).toContain("VER");
    expect(screen.getByText("Modell v0.1.0")).toBeDefined();
  });

  it("expands a driver's Bedrock explanation on click (US-2)", () => {
    render(<PodiumPredictions response={RESPONSE} raceName="Canada" raceDate="2026-06-07" />);
    // Explanation hidden until the row is clicked.
    expect(screen.queryByText(/Verstappen startet stark/)).toBeNull();

    const verButton = screen.getAllByRole("button").find((b) => b.textContent?.includes("VER"))!;
    fireEvent.click(verButton);

    expect(screen.queryByText(/Verstappen startet stark/)).not.toBeNull();
    expect(verButton.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows 'Begründung folgt' when a driver has no explanation yet", () => {
    render(<PodiumPredictions response={RESPONSE} raceName="Canada" raceDate="2026-06-07" />);
    const lecButton = screen.getAllByRole("button").find((b) => b.textContent?.includes("LEC"))!;
    fireEvent.click(lecButton);
    expect(screen.queryByText("Begründung folgt.")).not.toBeNull();
  });

  it("renders an empty state before predictions exist", () => {
    render(<PodiumPredictions response={null} raceName="Canada" raceDate="2026-06-07" />);
    expect(screen.queryByText(/erscheint rund eine Stunde/)).not.toBeNull();
  });
});
