import { z } from "zod";

/**
 * Team colour map (Phase 7, spec D-6). Cross-cutting data — the predictor hub
 * colours its driver cards and the dashboard tints its standings rows from the
 * SAME source (Constitution III). Driver→team comes from the Jolpica standings
 * (`constructor` name); team→colour is this map.
 *
 * `primary` is the brand fill, `accent` a lighter shade for gradients/hover.
 * Lookup is keyword-based so the many Jolpica/OpenF1 spellings of a team
 * ("Red Bull", "Red Bull Racing", "Oracle Red Bull Racing") all resolve.
 */

export const TeamColorSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type TeamColor = z.infer<typeof TeamColorSchema>;

/** Neutral fallback for an unknown/new team — never throws, never crashes a row. */
export const NEUTRAL_TEAM_COLOR: TeamColor = { primary: "#5a6473", accent: "#8a94a6" };

/**
 * Canonical key → colour. Keys are matched by `keyword ∈ normalized(name)`, so
 * order matters only for substrings (none overlap here). Covers the 2026 grid
 * incl. Audi (ex-Sauber) and the new Cadillac entry.
 */
export const TEAM_COLORS = {
  "red bull": { primary: "#3671c6", accent: "#5e8ee0" },
  ferrari: { primary: "#e8002d", accent: "#ff4d6a" },
  mercedes: { primary: "#27f4d2", accent: "#6ffbe6" },
  mclaren: { primary: "#ff8000", accent: "#ffa94d" },
  "aston martin": { primary: "#229971", accent: "#3fcf9c" },
  alpine: { primary: "#0093cc", accent: "#3fb8e6" },
  williams: { primary: "#64c4ff", accent: "#9bdaff" },
  "racing bulls": { primary: "#6692ff", accent: "#94b3ff" },
  rb: { primary: "#6692ff", accent: "#94b3ff" },
  audi: { primary: "#52e252", accent: "#86ec86" },
  sauber: { primary: "#52e252", accent: "#86ec86" },
  haas: { primary: "#b6babd", accent: "#d6d9db" },
  cadillac: { primary: "#c5a572", accent: "#dcc59a" },
} as const satisfies Record<string, TeamColor>;

export type TeamKey = keyof typeof TEAM_COLORS;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Resolve any constructor spelling to a colour. Keyword-contained match, so
 * "Oracle Red Bull Racing" → "red bull". Unknown → neutral (never throws).
 */
export function teamColor(constructorName: string | null | undefined): TeamColor {
  if (!constructorName) return NEUTRAL_TEAM_COLOR;
  const n = normalize(constructorName);
  for (const key of Object.keys(TEAM_COLORS) as TeamKey[]) {
    if (n.includes(key)) return TEAM_COLORS[key];
  }
  return NEUTRAL_TEAM_COLOR;
}

/** Minimal standings row shape needed to map a driver code → its constructor. */
export interface DriverTeamRow {
  code: string;
  constructor: string;
}

/**
 * Colour for a driver, looked up via the standings (driver code → constructor →
 * colour). Unknown driver or missing standings → neutral.
 */
export function driverTeamColor(
  driverCode: string,
  standings: readonly DriverTeamRow[] | null | undefined,
): TeamColor {
  if (!standings) return NEUTRAL_TEAM_COLOR;
  const row = standings.find((r) => r.code === driverCode);
  return row ? teamColor(row.constructor) : NEUTRAL_TEAM_COLOR;
}
