/**
 * Race-day weather forecast from Open-Meteo — free, no API key, CORS-enabled
 * (we still fetch server-side for caching). Open-Meteo only forecasts ~16 days
 * out, so a race further away simply returns `null` and the panel shows
 * "Wetter noch nicht verfügbar". Zod-validated (Constitution VI).
 */

import { z } from "zod";

const BASE = "https://api.open-meteo.com/v1/forecast";
const REVALIDATE_SECONDS = 3600;

const forecastEnvelope = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
    wind_speed_10m_max: z.array(z.number().nullable()),
  }),
});

export interface RaceDayForecast {
  date: string; // YYYY-MM-DD
  tempMax: number | null;
  tempMin: number | null;
  precipProb: number | null; // %
  windMax: number | null; // km/h
}

export async function getRaceDayForecast(
  lat: number,
  lon: number,
  dateIso: string,
): Promise<RaceDayForecast | null> {
  try {
    const url = new URL(BASE);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
    );
    url.searchParams.set("start_date", dateIso);
    url.searchParams.set("end_date", dateIso);
    url.searchParams.set("timezone", "UTC");
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = forecastEnvelope.safeParse(json);
    if (!parsed.success) return null;
    const d = parsed.data.daily;
    const i = d.time.indexOf(dateIso);
    if (i < 0) return null; // race day outside the forecast window
    return {
      date: dateIso,
      tempMax: d.temperature_2m_max[i] ?? null,
      tempMin: d.temperature_2m_min[i] ?? null,
      precipProb: d.precipitation_probability_max[i] ?? null,
      windMax: d.wind_speed_10m_max[i] ?? null,
    };
  } catch {
    return null;
  }
}
