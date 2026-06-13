/**
 * Client of the Phase-5 season-evaluations mode of the Read-API (same URL as
 * the predictions, `?season=<year>`). Zod-validated against the shared schema
 * (Constitution VI); any failure resolves to `null` so the page renders the
 * chart's empty state instead of crashing.
 */

import { type SeasonEvaluationResponse, SeasonEvaluationResponseSchema } from "@f1/shared";

const API_URL = process.env["NEXT_PUBLIC_PREDICTIONS_API_URL"];

/** ISR window: a season gains at most one evaluation per race weekend, so the
 * same few-minutes staleness as the predictions is plenty. */
const REVALIDATE_SECONDS = 300;

export async function fetchSeasonEvaluations(
  season: number,
): Promise<SeasonEvaluationResponse | null> {
  if (!API_URL) return null;
  try {
    const url = new URL(API_URL);
    url.searchParams.set("season", String(season));
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = SeasonEvaluationResponseSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
