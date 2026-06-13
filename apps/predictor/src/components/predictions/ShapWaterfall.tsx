import type { ShapContribution } from "@f1/shared";
import type { ReactNode } from "react";

import { buildWaterfall } from "../../lib/shap";
import styles from "../hub.module.css";

const W = 340;
const ROW = 26;
const LEFT = 150; // label column
const RIGHT = 44; // value column

/**
 * SHAP waterfall (AC-5): one row per feature, a bar running from the previous
 * cumulative total to the new one. Green pushes toward the podium, red away.
 * Pure SVG, server-renderable.
 */
export function ShapWaterfall({ contributions }: { contributions: ShapContribution[] }): ReactNode {
  if (contributions.length === 0) return null;
  const { bars, min, max } = buildWaterfall(contributions);
  const span = max - min || 1;
  const x = (v: number): number => LEFT + ((v - min) / span) * (W - LEFT - RIGHT);
  const H = bars.length * ROW + 8;

  return (
    <svg
      className={styles.waterfall}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="SHAP-Beiträge der Modell-Features"
    >
      {/* Baseline at value 0. */}
      <line x1={x(0)} x2={x(0)} y1={4} y2={H - 4} stroke="var(--border)" strokeWidth={1} />
      {bars.map((b, i) => {
        const y = i * ROW + 6;
        const pos = b.contribution >= 0;
        const x0 = Math.min(x(b.start), x(b.end));
        const w = Math.max(2, Math.abs(x(b.end) - x(b.start)));
        return (
          <g key={b.feature}>
            <text
              className={styles.wfLabel}
              x={LEFT - 8}
              y={y + ROW / 2}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {b.label}
            </text>
            <rect
              x={x0}
              y={y + 3}
              width={w}
              height={ROW - 12}
              rx={2}
              fill={pos ? "var(--pos)" : "var(--neg)"}
            />
            <text
              className={pos ? styles.wfValPos : styles.wfValNeg}
              x={W - 6}
              y={y + ROW / 2}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {pos ? "+" : ""}
              {b.contribution.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
