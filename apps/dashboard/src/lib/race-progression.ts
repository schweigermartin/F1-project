/**
 * Lap-by-lap and pit-stop data for one race from Jolpica (Phase 9, plan §3.1).
 *
 * Server-side only (Jolpica sends no CORS header) and Zod-validated per page
 * (Constitution VI). Every failure — network, non-200, shape drift, a round
 * that has not been run — resolves to `null`, so the race-analysis panel shows
 * a friendly empty state instead of taking the page down (AC-11).
 *
 * **Pagination is mandatory (spec R-2):** the Ergast default limit is 30 while
 * one race has ~1400 lap records, so a naive single fetch silently shows the
 * first two laps. We page with `limit=100` until `MRData.total` is covered, and
 * a page boundary may split a lap across two responses — hence the flattening
 * into `LapRecord[]` rather than trusting the per-lap grouping.
 *
 * ISR is deliberately long: a finished race never changes again.
 */

import { JolpicaLapsSchema, JolpicaPitStopsSchema, nextJolpicaOffset } from "@f1/shared";
import type { z } from "zod";

import type { LapRecord, PitStopRecord } from "./race-analysis";

const BASE = "https://api.jolpi.ca/ergast/f1";
/** 30 days — classifications are final; only a stewards' decision could move them. */
const REVALIDATE_SECONDS = 60 * 60 * 24 * 30;
const PAGE_LIMIT = 100;
/**
 * Hard stop for the paging loop: 60 pages = 6000 records, four times the
 * largest race ever recorded. A server that mis-reports `total` costs us a
 * bounded number of requests, never an infinite loop.
 */
const MAX_PAGES = 60;

export interface LapChart {
  season: number;
  round: number;
  raceName: string;
  date: string;
  /** Highest lap number seen — the race distance. */
  totalLaps: number;
  records: LapRecord[];
}

async function fetchPage<T>(url: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function pageUrl(season: number, round: number, resource: string, offset: number): string {
  return `${BASE}/${season}/${round}/${resource}/?format=json&limit=${PAGE_LIMIT}&offset=${offset}`;
}

/**
 * Every lap of every driver for one round, or `null` if the race has no lap
 * data (not run yet, cancelled, or pre-1996 where Ergast has none).
 *
 * A page that fails to fetch or validate aborts the whole chart: half a race
 * would draw a plausible-looking but wrong picture, and that is exactly the
 * silent-drift failure Constitution VI forbids.
 */
export async function getLapChart(season: number, round: number): Promise<LapChart | null> {
  const records: LapRecord[] = [];
  let meta: { raceName: string; date: string } | null = null;
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(pageUrl(season, round, "laps", offset), JolpicaLapsSchema);
    if (!data) return null;

    const race = data.MRData.RaceTable.Races[0];
    if (!race) break; // round exists but carries no lap data
    meta ??= { raceName: race.raceName, date: race.date };

    const before = records.length;
    for (const lap of race.Laps) {
      for (const timing of lap.Timings) {
        records.push({
          lap: lap.number,
          driverId: timing.driverId,
          position: timing.position,
          time: timing.time,
        });
      }
    }

    const next = nextJolpicaOffset(data.MRData);
    // A page that added nothing while claiming more is left would spin forever.
    if (next === null || records.length === before) break;
    offset = next;
  }

  if (!meta || records.length === 0) return null;
  return {
    season,
    round,
    raceName: meta.raceName,
    date: meta.date,
    totalLaps: records.reduce((max, r) => Math.max(max, r.lap), 0),
    records,
  };
}

/**
 * Every pit stop of one round. Paginated too — a 45-stop race already exceeds
 * the default limit of 30. `null` means "could not load" (the caller keeps the
 * position chart, just without markers); `[]` means the round reported none.
 */
export async function getPitStops(season: number, round: number): Promise<PitStopRecord[] | null> {
  const stops: PitStopRecord[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(pageUrl(season, round, "pitstops", offset), JolpicaPitStopsSchema);
    if (!data) return null;

    const race = data.MRData.RaceTable.Races[0];
    if (!race) break;

    const before = stops.length;
    for (const stop of race.PitStops) {
      stops.push({
        driverId: stop.driverId,
        lap: stop.lap,
        stop: stop.stop,
        duration: stop.duration,
      });
    }

    const next = nextJolpicaOffset(data.MRData);
    if (next === null || stops.length === before) break;
    offset = next;
  }

  return stops;
}
