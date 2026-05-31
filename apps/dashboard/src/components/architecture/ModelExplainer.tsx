"use client";

import { scaleLinear } from "@visx/scale";
import type { ReactNode } from "react";

import {
  isModelPlaceholder,
  type MetricRow,
  MODEL_FEATURES,
  MODEL_METRICS,
} from "../../lib/architecture-data";

const BAR_W = 520;
const ROW_H = 30;
const LABEL_W = 200;

/**
 * Explains the Phase-3 podium classifier: the 6 pre-race features ranked by SHAP
 * importance and the model vs. the grid-top-3 baseline. Values are illustrative
 * until the artifact is published (isModelPlaceholder).
 */
export function ModelExplainer(): ReactNode {
  const maxImp = Math.max(...MODEL_FEATURES.map((f) => f.importance));
  const x = scaleLinear<number>({ domain: [0, maxImp], range: [0, BAR_W - LABEL_W - 56] });

  return (
    <div>
      <p style={{ margin: "0 0 1rem", color: "var(--muted)", lineHeight: 1.5 }}>
        Ein XGBoost-Classifier schätzt pro Fahrer die Wahrscheinlichkeit, auf dem Podium (P≤3) zu
        landen — nur aus <strong style={{ color: "var(--fg)" }}>vor dem Rennen bekannten</strong>{" "}
        Features (kein Leakage). SHAP zeigt, welches Feature die Vorhersage treibt.
        {isModelPlaceholder ? (
          <em style={{ color: "#caa54a" }}>
            {" "}
            Zahlen illustrativ — werden nach dem Phase-3-Publish durch die echten Werte ersetzt.
          </em>
        ) : null}
      </p>

      <svg
        viewBox={`0 0 ${BAR_W} ${MODEL_FEATURES.length * ROW_H + 8}`}
        width="100%"
        role="img"
        aria-label="SHAP-Feature-Wichtigkeit des Podium-Modells"
      >
        {MODEL_FEATURES.map((f, i) => {
          const y = i * ROW_H + 4;
          const w = Math.max(2, x(f.importance));
          return (
            <g key={f.name}>
              <text
                x={LABEL_W - 10}
                y={y + ROW_H / 2}
                dy="0.32em"
                textAnchor="end"
                fontSize={11.5}
                fill="#e6e6e6"
              >
                {f.label}
              </text>
              <rect
                x={LABEL_W}
                y={y + 4}
                width={w}
                height={ROW_H - 14}
                rx={3}
                fill="var(--accent)"
              />
              <text
                x={LABEL_W + w + 6}
                y={y + ROW_H / 2}
                dy="0.32em"
                fontSize={10.5}
                fill="#8a94a6"
              >
                {(f.importance * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}
      </svg>

      <table
        style={{
          width: "100%",
          marginTop: "1.25rem",
          borderCollapse: "collapse",
          fontSize: "0.9rem",
        }}
      >
        <thead>
          <tr style={{ color: "var(--muted)", textAlign: "left" }}>
            <th style={{ padding: "0.4rem 0.5rem" }}>Metrik</th>
            <th style={{ padding: "0.4rem 0.5rem" }}>Modell</th>
            <th style={{ padding: "0.4rem 0.5rem" }}>Baseline (Grid-Top-3)</th>
          </tr>
        </thead>
        <tbody>
          {MODEL_METRICS.map((m) => (
            <MetricTableRow key={m.label} row={m} />
          ))}
        </tbody>
      </table>
      <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
        Baseline = „Podium ist genau, wer von Startplatz 1–3 losfährt“. Das Modell muss sie
        schlagen, um seinen Aufwand zu rechtfertigen.
      </p>
    </div>
  );
}

function fmt(value: number, kind: MetricRow["fmt"]): string {
  return kind === "pct" ? `${(value * 100).toFixed(0)}%` : value.toFixed(2);
}

function MetricTableRow({ row }: { row: MetricRow }): ReactNode {
  // Log-Loss is better when lower; the rest better when higher.
  const lowerIsBetter = row.label.toLowerCase().includes("loss");
  const modelWins = lowerIsBetter ? row.model < row.baseline : row.model > row.baseline;
  return (
    <tr style={{ borderTop: "1px solid #1c2230" }}>
      <td style={{ padding: "0.45rem 0.5rem" }}>{row.label}</td>
      <td
        style={{
          padding: "0.45rem 0.5rem",
          color: modelWins ? "#1f9d57" : "var(--fg)",
          fontWeight: 600,
        }}
      >
        {fmt(row.model, row.fmt)}
      </td>
      <td style={{ padding: "0.45rem 0.5rem", color: "var(--muted)" }}>
        {fmt(row.baseline, row.fmt)}
      </td>
    </tr>
  );
}
