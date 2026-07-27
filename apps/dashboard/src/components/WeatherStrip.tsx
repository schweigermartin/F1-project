import type { Weather } from "@f1/shared";
import type { ReactNode } from "react";

import styles from "./live.module.css";

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  );
}

export function WeatherStrip({ weather }: { weather: Weather | null }): ReactNode {
  if (!weather) return null;
  return (
    <div className={styles.weather}>
      <Metric label="Air" value={`${weather.air_temperature.toFixed(0)}°C`} />
      <Metric label="Track" value={`${weather.track_temperature.toFixed(0)}°C`} />
      <Metric label="Humidity" value={`${weather.humidity.toFixed(0)}%`} />
      <Metric label="Wind" value={`${weather.wind_speed.toFixed(1)} m/s`} />
      <Metric label="Rain" value={weather.rainfall > 0 ? "Wet" : "Dry"} />
    </div>
  );
}
