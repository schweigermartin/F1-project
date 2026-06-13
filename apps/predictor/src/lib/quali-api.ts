/**
 * Qualifying grid for the target round (AC-6) — lets the hub put each driver's
 * real starting slot next to the model's podium probability. Free Jolpica API,
 * server-side, Zod-validated. Absent before qualifying → `null`, and the
 * Grid-vs-Prediction block hides itself.
 */

import { z } from "zod";

const BASE = "https://api.jolpi.ca/ergast/f1";
const REVALIDATE_SECONDS = 3600;

const qualiEnvelope = z.object({
  MRData: z.object({
    RaceTable: z.object({
      Races: z.array(
        z.object({
          QualifyingResults: z.array(
            z.object({
              position: z.string(),
              Driver: z.object({
                code: z.string().optional(),
                familyName: z.string(),
              }),
            }),
          ),
        }),
      ),
    }),
  }),
});

export interface GridSlot {
  code: string;
  grid: number;
}

export async function getQualifyingGrid(season: number, round: number): Promise<GridSlot[] | null> {
  try {
    const res = await fetch(`${BASE}/${season}/${round}/qualifying/?format=json`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = qualiEnvelope.safeParse(json);
    if (!parsed.success) return null;
    const results = parsed.data.MRData.RaceTable.Races[0]?.QualifyingResults;
    if (!results || results.length === 0) return null;
    return results.map((r) => ({
      code: r.Driver.code ?? r.Driver.familyName.slice(0, 3).toUpperCase(),
      grid: Number(r.position),
    }));
  } catch {
    return null;
  }
}
