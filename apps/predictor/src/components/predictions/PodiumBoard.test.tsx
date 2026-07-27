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

  it("expands the top-1 driver's explanation by default (AC-9)", () => {
    render(
      <PodiumBoard
        response={DEMO_PREDICTIONS}
        raceName="Demo GP"
        raceDate="2026-06-07"
        standings={DEMO_STANDINGS}
      />,
    );
    // LEC has the highest podium probability (0.83) in the demo set — its
    // Bedrock explanation and SHAP waterfall are visible without a click.
    const topBtn = screen.getByText("LEC").closest("button") as HTMLElement;
    expect(topBtn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Pole-Position/)).toBeDefined();
    expect(screen.getByLabelText(/SHAP-Beiträge/)).toBeDefined();
  });

  it("reveals another driver's explanation only after expanding its row", () => {
    render(
      <PodiumBoard
        response={DEMO_PREDICTIONS}
        raceName="Demo GP"
        raceDate="2026-06-07"
        standings={DEMO_STANDINGS}
      />,
    );
    expect(screen.queryByText(/starke Form/)).toBeNull();
    fireEvent.click(screen.getByText("VER").closest("button") as HTMLElement);
    expect(screen.getByText(/starke Form/)).toBeDefined();
  });

  it("shows the pre-race empty state when there are no predictions", () => {
    render(
      <PodiumBoard response={null} raceName="Demo GP" raceDate="2026-06-07" standings={null} />,
    );
    expect(screen.getByText(/erscheint rund eine Stunde/)).toBeDefined();
  });
});
