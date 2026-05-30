import type { DriverState } from "@f1/shared";
import type { ReactNode } from "react";

import { formatGap, formatLapTime, tyreInfo } from "../lib/format";

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "0.35rem 0.6rem",
  color: "var(--muted)",
  fontSize: "0.7rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 600,
};

const TD: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  fontVariantNumeric: "tabular-nums",
  borderTop: "1px solid #1c2230",
};

function TyreBadge({ compound, age }: { compound: string | null; age: number | null }): ReactNode {
  const { label, color } = tyreInfo(compound);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: `2px solid ${color}`,
          color,
          fontSize: "0.65rem",
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {label}
      </span>
      <span style={{ color: "var(--muted)" }}>{age === null ? "" : `${age}L`}</span>
    </span>
  );
}

export function TimingTower({ drivers }: { drivers: DriverState[] }): ReactNode {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
      <thead>
        <tr>
          <th style={{ ...TH, width: 36 }}>Pos</th>
          <th style={TH}>Driver</th>
          <th style={TH}>Gap</th>
          <th style={TH}>Interval</th>
          <th style={TH}>Tyre</th>
          <th style={TH}>Last lap</th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d) => (
          <tr key={d.driver_number}>
            <td style={{ ...TD, fontWeight: 700 }}>{d.position ?? "—"}</td>
            <td style={TD}>#{d.driver_number}</td>
            <td style={TD}>{formatGap(d.gap_to_leader)}</td>
            <td style={TD}>{formatGap(d.interval)}</td>
            <td style={TD}>
              <TyreBadge compound={d.compound} age={d.tyre_age} />
            </td>
            <td style={TD}>{formatLapTime(d.last_lap_duration)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
