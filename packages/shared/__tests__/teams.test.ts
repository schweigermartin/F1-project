import { describe, expect, it } from "vitest";

import {
  driverTeamColor,
  NEUTRAL_TEAM_COLOR,
  TEAM_COLORS,
  teamColor,
  TeamColorSchema,
} from "../src/teams.js";

describe("teamColor", () => {
  it("resolves long official spellings via keyword match", () => {
    expect(teamColor("Oracle Red Bull Racing")).toEqual(TEAM_COLORS["red bull"]);
    expect(teamColor("Scuderia Ferrari HP")).toEqual(TEAM_COLORS.ferrari);
    expect(teamColor("Mercedes-AMG Petronas")).toEqual(TEAM_COLORS.mercedes);
  });

  it("maps the ex-Sauber / Audi rename to one colour", () => {
    expect(teamColor("Kick Sauber")).toEqual(TEAM_COLORS.sauber);
    expect(teamColor("Audi")).toEqual(TEAM_COLORS.audi);
  });

  it("falls back to neutral for unknown or empty teams", () => {
    expect(teamColor("Some New 2030 Team")).toEqual(NEUTRAL_TEAM_COLOR);
    expect(teamColor(null)).toEqual(NEUTRAL_TEAM_COLOR);
    expect(teamColor(undefined)).toEqual(NEUTRAL_TEAM_COLOR);
  });

  it("every colour is a valid 6-digit hex pair", () => {
    for (const c of Object.values(TEAM_COLORS)) {
      expect(TeamColorSchema.safeParse(c).success).toBe(true);
    }
  });
});

describe("driverTeamColor", () => {
  const standings = [
    { code: "VER", constructor: "Red Bull Racing" },
    { code: "LEC", constructor: "Ferrari" },
  ];

  it("maps a driver code through the standings to a team colour", () => {
    expect(driverTeamColor("VER", standings)).toEqual(TEAM_COLORS["red bull"]);
    expect(driverTeamColor("LEC", standings)).toEqual(TEAM_COLORS.ferrari);
  });

  it("returns neutral when the driver or standings are missing", () => {
    expect(driverTeamColor("XXX", standings)).toEqual(NEUTRAL_TEAM_COLOR);
    expect(driverTeamColor("VER", null)).toEqual(NEUTRAL_TEAM_COLOR);
  });
});
