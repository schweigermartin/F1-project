"use client";

import { scaleLinear } from "@visx/scale";
import type { ReactNode } from "react";

import {
  isModelPlaceholder,
  type MetricRow,
  MODEL_EXAMPLE,
  MODEL_FEATURES,
  MODEL_METRICS,
} from "../../lib/architecture-data";
import styles from "./architecture.module.css";

const BAR_W = 560;
const ROW_H = 34;
const LABEL_W = 210;

/**
 * Explains the Phase-3 podium classifier in plain language: the 6 pre-race
 * features ranked by SHAP importance, the model vs. the grid-top-3 baseline, and
 * one worked example. Values are illustrative until the artifact publishes
 * (isModelPlaceholder).
 */
export function ModelExplainer(): ReactNode {
  const maxImp = Math.max(...MODEL_FEATURES.map((f) => f.importance));
  const x = scaleLinear<number>({ domain: [0, maxImp], range: [0, BAR_W - LABEL_W - 64] });

  return (
    <div>
      <p style={{ margin: "0 0 0.4rem", color: "#aab3c2", lineHeight: 1.6 }}>
        Die Frage:{" "}
        <strong style={{ color: "var(--fg)" }}>Wer landet auf dem Podium (Platz 1–3)?</strong> Ein
        XGBoost-Modell schätzt pro Fahrer eine Wahrscheinlichkeit — nur aus Dingen, die{" "}
        <strong style={{ color: "var(--fg)" }}>vor dem Start</strong> schon bekannt sind (kein Blick
        in die Zukunft). Die Balken zeigen, welche Information am stärksten zählt.
      </p>
      {isModelPlaceholder ? (
        <span className={styles.badge}>Zahlen illustrativ — echte Werte folgen mit Phase 3</span>
      ) : null}

      <svg
        viewBox={`0 0 ${BAR_W} ${MODEL_FEATURES.length * ROW_H + 8}`}
        width="100%"
        role="img"
        aria-label="SHAP-Feature-Wichtigkeit des Podium-Modells"
        style={{ marginTop: "1rem" }}
      >
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#e10600" />
            <stop offset="1" stopColor="#ff6b4a" />
          </linearGradient>
        </defs>
        {MODEL_FEATURES.map((f, i) => {
          const y = i * ROW_H + 4;
          const w = Math.max(3, x(f.importance));
          const barH = ROW_H - 16;
          return (
            <g key={f.name}>
              <text
                x={LABEL_W - 12}
                y={y + ROW_H / 2}
                dy="0.32em"
                textAnchor="end"
                fontSize={12}
                fill="#cdd4df"
              >
                {f.label}
              </text>
              <rect x={LABEL_W} y={y + 4} width={w} height={barH} rx={5} fill="url(#barGrad)" />
              <text
                x={LABEL_W + w + 8}
                y={y + ROW_H / 2}
                dy="0.32em"
                fontSize={11}
                fontWeight={600}
                fill="#aab3c2"
              >
                {(f.importance * 100).toFixed(0)} %
              </text>
            </g>
          );
        })}
      </svg>

      <h3 style={{ margin: "1.4rem 0 0", fontSize: "0.95rem" }}>
        Schlägt es die simple Faustregel?
      </h3>
      <p
        style={{
          margin: "0.3rem 0 0",
          fontSize: "0.85rem",
          color: "var(--muted)",
          lineHeight: 1.5,
        }}
      >
        Baseline = „Podium ist genau, wer von Startplatz 1–3 losfährt“. Das Modell muss sie
        schlagen, um seinen Aufwand zu rechtfertigen.
      </p>

      <div className={styles.metricGrid}>
        {MODEL_METRICS.map((m) => (
          <MetricCard key={m.label} row={m} />
        ))}
      </div>

      <div className={styles.example}>
        <span style={{ color: "var(--muted)" }}>Beispiel:</span>
        <strong>{MODEL_EXAMPLE.driver}</strong>
        <span style={{ color: "var(--muted)" }}>{MODEL_EXAMPLE.context}</span>
        <span aria-hidden>→</span>
        <span className={styles.exampleProb}>{(MODEL_EXAMPLE.probability * 100).toFixed(0)} %</span>
        <span style={{ color: "var(--muted)" }}>Podium-Chance</span>
      </div>
    </div>
  );
}

function fmt(value: number, kind: MetricRow["fmt"]): string {
  return kind === "pct" ? `${(value * 100).toFixed(0)} %` : value.toFixed(2);
}

function MetricCard({ row }: { row: MetricRow }): ReactNode {
  // Log-Loss is better when lower; the rest better when higher.
  const lowerIsBetter = row.label.toLowerCase().includes("loss");
  const modelWins = lowerIsBetter ? row.model < row.baseline : row.model > row.baseline;
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabel}>{row.label}</div>
      <div className={styles.metricRow}>
        <span className={`${styles.metricModel} ${modelWins ? styles.win : ""}`}>
          {fmt(row.model, row.fmt)}
        </span>
        <span className={styles.metricBase}>vs {fmt(row.baseline, row.fmt)}</span>
      </div>
      <div className={styles.metricHint}>{row.hint}</div>
    </div>
  );
}
