/**
 * Recent winners at the target circuit (AC-7) — context for the prediction:
 * does this track favour certain drivers/teams? Free Jolpica API, server-side,
 * Zod-validated, long ISR cache (history barely changes). Failure → `null`,
 * panel shows a friendly note.
 *
 * `circuits/<id>/results/1` returns every race at that circuit where someone
 * finished P1, i.e. the list of winners across seasons.
 */

import { z } from "zod";

const BASE = "https://api.jolpi.ca/ergast/f1";
const REVALIDATE_SECONDS = 60 * 60 * 24; // 24h

const winnersEnvelope = z.object({
  MRData: z.object({
    RaceTable: z.object({
      Races: z.array(
        z.object({
          season: z.string(),
          raceName: z.string(),
          Results: z.array(
            z.object({
              Driver: z.object({
                givenName: z.string(),
                familyName: z.string(),
                code: z.string().optional(),
              }),
              Constructor: z.object({ name: z.string() }),
            }),
          ),
        }),
      ),
    }),
  }),
});

export interface TrackWinner {
  year: number;
  driver: string;
  code: string;
  constructor: string;
}

export async function getTrackWinners(
  circuitId: string,
  n = 5,
): Promise<TrackWinner[] | null> {
  try {
    const res = await fetch(`${BASE}/circuits/${circuitId}/results/1/?format=json&limit=60`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = winnersEnvelope.safeParse(json);
    if (!parsed.success) return null;
    const winners = parsed.data.MRData.RaceTable.Races.flatMap((race) => {
      const w = race.Results[0];
      if (!w) return [];
      return [
        {
          year: Number(race.season),
          driver: `${w.Driver.givenName} ${w.Driver.familyName}`,
          code: w.Driver.code ?? w.Driver.familyName.slice(0, 3).toUpperCase(),
          constructor: w.Constructor.name,
        },
      ];
    });
    return winners.sort((a, b) => b.year - a.year).slice(0, n);
  } catch {
    return null;
  }
}
