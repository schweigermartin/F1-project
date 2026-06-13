import type { Weather } from "@f1/shared";
import type { ReactNode } from "react";

import type { RaceDayForecast } from "../../lib/weather-api";
import styles from "../hub.module.css";

export interface WeatherPanelProps {
  forecast: RaceDayForecast | null;
  /** Live OpenF1 weather (preferred when a session is active). */
  live?: Weather | null;
}

function tile(label: string, value: string, live = false): ReactNode {
  return (
    <div className={styles.wxTile} key={label}>
      <div className={`${styles.wxVal} ${live ? styles.wxLive : ""}`}>{value}</div>
      <div className={styles.wxLabel}>{label}</div>
    </div>
  );
}

/**
 * Race-day forecast (Open-Meteo) or live values (OpenF1) when a session runs
 * (AC-4). No data → friendly note, never a crash.
 */
export function WeatherPanel({ forecast, live }: WeatherPanelProps): ReactNode {
  const hasLive = !!live;
  return (
    <section className={`card ${styles.col4}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Wetter</h2>
        <span className={styles.panelMeta}>{hasLive ? "live" : "Renntag-Prognose"}</span>
      </div>
      {hasLive && live ? (
        <div className={styles.wxGrid}>
          {tile("Luft", `${Math.round(live.air_temperature)}°C`, true)}
          {tile("Strecke", `${Math.round(live.track_temperature)}°C`, true)}
          {tile("Wind", `${Math.round(live.wind_speed)} km/h`, true)}
          {tile("Regen", live.rainfall > 0 ? "ja" : "trocken", true)}
        </div>
      ) : forecast ? (
        <div className={styles.wxGrid}>
          {tile("Max", forecast.tempMax !== null ? `${Math.round(forecast.tempMax)}°C` : "—")}
          {tile("Min", forecast.tempMin !== null ? `${Math.round(forecast.tempMin)}°C` : "—")}
          {tile(
            "Regen",
            forecast.precipProb !== null ? `${Math.round(forecast.precipProb)} %` : "—",
          )}
          {tile("Wind", forecast.windMax !== null ? `${Math.round(forecast.windMax)} km/h` : "—")}
        </div>
      ) : (
        <p className={styles.empty}>
          Wettervorhersage noch nicht verfügbar — sie erscheint, sobald der Renntag näher rückt.
        </p>
      )}
    </section>
  );
}
