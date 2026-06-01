/**
 * Client of the Phase-4 predictions Read-API (the only path to the data — no
 * direct DDB/Bedrock from the browser). Every response is Zod-validated against
 * the shared schema (Constitution VI): a drifted/partial payload resolves to
 * `null` and the page degrades to an empty state instead of crashing.
 */

import {
  type PredictionApiResponse,
  PredictionApiResponseSchema,
  type PredictionWithExplanation,
} from "@f1/shared";

const API_URL = process.env["NEXT_PUBLIC_PREDICTIONS_API_URL"];

/** ISR window: predictions change at most once per race (T-60min), so a few
 * minutes of staleness is fine and keeps the Read-API cheap. */
const REVALIDATE_SECONDS = 300;

export async function fetchRacePredictions(
  raceDate: string,
  round: number,
): Promise<PredictionApiResponse | null> {
  if (!API_URL) return null;
  try {
    const url = new URL(API_URL);
    url.searchParams.set("race_date", raceDate);
    url.searchParams.set("round", String(round));
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null; // 404 = no predictions yet (before T-60min)
    const json: unknown = await res.json();
    const parsed = PredictionApiResponseSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Podium order (US-1): highest probability first. Pure + stable copy. */
export function sortByPodium(drivers: PredictionWithExplanation[]): PredictionWithExplanation[] {
  return [...drivers].sort((a, b) => b.podium_probability - a.podium_probability);
}
