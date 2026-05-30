import type { Weather } from "@f1/shared";
import type { ReactNode } from "react";

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 64 }}>
      <span style={{ color: "var(--muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: "0.95rem", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

export function WeatherStrip({ weather }: { weather: Weather | null }): ReactNode {
  if (!weather) return null;
  return (
    <div
      style={{
        display: "flex",
        gap: "1.25rem",
        padding: "0.75rem 1rem",
        background: "#11161f",
        borderRadius: 8,
        flexWrap: "wrap",
      }}
    >
      <Metric label="Air" value={`${weather.air_temperature.toFixed(0)}°C`} />
      <Metric label="Track" value={`${weather.track_temperature.toFixed(0)}°C`} />
      <Metric label="Humidity" value={`${weather.humidity.toFixed(0)}%`} />
      <Metric label="Wind" value={`${weather.wind_speed.toFixed(1)} m/s`} />
      <Metric label="Rain" value={weather.rainfall > 0 ? "Wet" : "Dry"} />
    </div>
  );
}
