import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEMO_PREDICTIONS, DEMO_STANDINGS } from "../../lib/demo-data";
import { PodiumBoard } from "./PodiumBoard";

afterEach(cleanup);

describe("PodiumBoard", () => {
  it("sorts drivers by podium probability (US-1) — highest first", () => {
    render(
      <PodiumBoard
        response={DEMO_PREDICTIONS}
        raceName="Demo GP"
        raceDate="2026-06-07"
        standings={DEMO_STANDINGS}
      />,
    );
    const codes = screen.getAllByText(/^(VER|LEC|NOR|HAM)$/).map((el) => el.textContent);
    expect(codes[0]).toBe("LEC"); // 0.83 — highest in the demo set
  });

  it("reveals the SHAP waterfall + explanation only after expanding a row", () => {
    render(
      <PodiumBoard
        response={DEMO_PREDICTIONS}
        raceName="Demo GP"
        raceDate="2026-06-07"
        standings={DEMO_STANDINGS}
      />,
    );
    expect(screen.queryByText(/Pole-Position/)).toBeNull();
    fireEvent.click(screen.getByText("LEC").closest("button") as HTMLElement);
    expect(screen.getByText(/Pole-Position/)).toBeDefined();
    expect(screen.getByLabelText(/SHAP-Beiträge/)).toBeDefined();
  });

  it("shows the pre-race empty state when there are no predictions", () => {
    render(
      <PodiumBoard response={null} raceName="Demo GP" raceDate="2026-06-07" standings={null} />,
    );
    expect(screen.getByText(/erscheint rund eine Stunde/)).toBeDefined();
  });
});
