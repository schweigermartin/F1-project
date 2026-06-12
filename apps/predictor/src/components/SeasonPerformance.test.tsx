import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEMO_SEASON_EVALUATIONS } from "../lib/demo-data";
import { SeasonPerformance } from "./SeasonPerformance";

afterEach(cleanup);

describe("SeasonPerformance", () => {
  it("renders one hit-rate and one brier point per evaluated race (US-2)", () => {
    render(<SeasonPerformance response={DEMO_SEASON_EVALUATIONS} />);
    expect(screen.getAllByTestId("hit-point")).toHaveLength(3);
    expect(screen.getAllByTestId("brier-point")).toHaveLength(3);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("3 ausgewerteten Rennen");
  });

  it("labels the x-axis with the championship rounds", () => {
    render(<SeasonPerformance response={DEMO_SEASON_EVALUATIONS} />);
    for (const race of DEMO_SEASON_EVALUATIONS.races) {
      expect(screen.getByText(`R${race.round}`)).toBeDefined();
    }
  });

  it("puts race detail (podium, model version) into the point tooltip", () => {
    render(<SeasonPerformance response={DEMO_SEASON_EVALUATIONS} />);
    const tooltips = screen
      .getAllByTestId("hit-point")
      .map((c) => c.querySelector("title")?.textContent ?? "");
    expect(tooltips[0]).toContain("Modell v0.1.0");
    expect(tooltips[0]).toContain("NOR"); // actual winner of the first demo race
    expect(tooltips[0]).toContain("#81"); // unpredicted podium driver → number fallback
  });

  it("shows the empty state when no race has been evaluated yet (AC-3)", () => {
    render(<SeasonPerformance response={{ schema_version: 1, season: 2026, races: [] }} />);
    expect(screen.getByText(/Noch keine ausgewerteten Rennen/)).toBeDefined();
    expect(screen.queryAllByTestId("hit-point")).toHaveLength(0);
  });

  it("shows the empty state when the API was unreachable (response null)", () => {
    render(<SeasonPerformance response={null} />);
    expect(screen.getByText(/Noch keine ausgewerteten Rennen/)).toBeDefined();
  });
});
