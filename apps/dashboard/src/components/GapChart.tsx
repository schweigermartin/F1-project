import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import type { ReactNode } from "react";

import type { GapBar } from "../lib/format";

const W = 640;
const ROW = 26;
const MARGIN = { top: 8, right: 64, bottom: 8, left: 44 };

/** Horizontal bar chart of each driver's gap to the leader, ordered by position. */
export function GapChart({ bars }: { bars: GapBar[] }): ReactNode {
  if (bars.length === 0) return null;

  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = bars.length * ROW;
  const H = innerH + MARGIN.top + MARGIN.bottom;

  const maxGap = Math.max(1, ...bars.map((b) => b.gapSeconds));
  const x = scaleLinear<number>({ domain: [0, maxGap], range: [0, innerW] });
  const y = scaleBand<number>({
    domain: bars.map((b) => b.driver_number),
    range: [0, innerH],
    padding: 0.2,
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="gap to leader chart">
      <Group left={MARGIN.left} top={MARGIN.top}>
        {bars.map((b) => {
          const barW = Math.max(2, x(b.gapSeconds));
          const barY = y(b.driver_number) ?? 0;
          const bh = y.bandwidth();
          return (
            <Group key={b.driver_number}>
              <text
                x={-8}
                y={barY + bh / 2}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="#e6e6e6"
              >
                #{b.driver_number}
              </text>
              <Bar
                x={0}
                y={barY}
                width={barW}
                height={bh}
                rx={3}
                fill={b.lapped ? "#5a6473" : "var(--accent)"}
              />
              <text x={barW + 6} y={barY + bh / 2} dy="0.32em" fontSize={10} fill="#8a94a6">
                {b.lapped ? "+1 LAP" : `+${b.gapSeconds.toFixed(1)}s`}
              </text>
            </Group>
          );
        })}
      </Group>
    </svg>
  );
}
