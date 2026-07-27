/**
 * Final classification (top-3) for a race that has already happened (T11/AC-4):
 * straight from the free Jolpica/Ergast results endpoint — deliberately
 * independent of the Phase-5 evaluation pipeline (`fetchSeasonEvaluations`),
 * which only has a row once `F1-Evaluation` has run against that race's
 * archived session. That decoupling matters here: it's what lets the
 * prediction archive show "predicted vs. actual" for every past round, not
 * just the ones the (separately-fixed) ingest pipeline happened to catch.
 *
 * Same fetch style as `history-api.ts`/`quali-api.ts`/`standings-api.ts`:
 * server-side only, Zod-validated (Constitution VI), long ISR cache (a
 * finished race's result never changes), `null` on any failure so the panel
 * degrades instead of crashing (AC-11).
 */

import { z } from "zod";

import type { ActualSlot } from "./live-diff";

const BASE = "https://api.jolpi.ca/ergast/f1";
const REVALIDATE_SECONDS = 60 * 60 * 24; // 24h — a finished race's result is immutable

const resultsEnvelope = z.object({
  MRData: z.object({
    RaceTable: z.object({
      Races: z.array(
        z.object({
          Results: z.array(
            z.object({
              position: z.string(),
              Driver: z.object({
                familyName: z.string(),
                code: z.string().optional(),
              }),
            }),
          ),
        }),
      ),
    }),
  }),
});

/** Top-3 finishers, straight from Jolpica. `null` if the race hasn't been
 * classified yet (or on any network/schema failure). */
export async function getRaceResult(season: number, round: number): Promise<ActualSlot[] | null> {
  try {
    const res = await fetch(`${BASE}/${season}/${round}/results/?format=json&limit=3`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = resultsEnvelope.safeParse(json);
    if (!parsed.success) return null;
    const results = parsed.data.MRData.RaceTable.Races[0]?.Results;
    if (!results || results.length === 0) return null;
    return results.map((r) => ({
      position: Number(r.position),
      code: r.Driver.code ?? r.Driver.familyName.slice(0, 3).toUpperCase(),
    }));
  } catch {
    return null;
  }
}
