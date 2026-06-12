import type { RaceEvaluation, SeasonEvaluationResponse } from "@f1/shared";
import type { ReactNode } from "react";

import styles from "./season.module.css";

/**
 * Saison-Performance chart (Phase 5, AC-3/US-2): top-3 hit-rate and Brier
 * score per evaluated race. Dependency-free inline SVG — ~24 points per
 * season don't justify a chart library (same bias as the CSS prediction
 * bars). Server-renderable: no state, tooltips via native <title>.
 */

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 14, bottom: 26, left: 34 };

interface Point {
  x: number;
  yHit: number;
  yBrier: number;
  race: RaceEvaluation;
}

/** Both metrics live on a 0–1 scale, so one shared Y axis works. */
function yFor(value: number): number {
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  return PAD.top + (1 - value) * innerH;
}

function buildPoints(races: RaceEvaluation[]): Point[] {
  const innerW = WIDTH - PAD.left - PAD.right;
  // X by index, not round number: gaps (skipped races) would otherwise tear
  // holes into the polyline without adding information.
  const step = races.length > 1 ? innerW / (races.length - 1) : 0;
  return races.map((race, i) => ({
    x: PAD.left + (races.length > 1 ? i * step : innerW / 2),
    yHit: yFor(race.top3_hit_rate),
    yBrier: yFor(race.brier_score),
    race,
  }));
}

function polyline(points: Point[], pick: (p: Point) => number): string {
  return points.map((p) => `${p.x.toFixed(1)},${pick(p).toFixed(1)}`).join(" ");
}

export interface SeasonPerformanceProps {
  response: SeasonEvaluationResponse | null;
}

export function SeasonPerformance({ response }: SeasonPerformanceProps): ReactNode {
  const races = response?.races ?? [];

  return (
    <section className={styles.section} aria-label="Saison-Performance">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Saison-Performance</h2>
          <p className={styles.sub}>
            Wie gut traf das Modell? Vorhersage vs. tatsächliches Podium, pro Rennen.
          </p>
        </div>
        {races.length > 0 ? (
          <div className={styles.legend}>
            <span className={styles.legendHit}>Top-3-Trefferquote</span>
            <span className={styles.legendBrier}>Brier Score (kleiner = besser)</span>
          </div>
        ) : null}
      </header>

      {races.length === 0 ? (
        <p className={styles.empty}>
          Noch keine ausgewerteten Rennen — der Chart füllt sich, sobald das erste vorhergesagte
          Rennen gelaufen und ausgewertet ist.
        </p>
      ) : (
        <SeasonChart races={races} />
      )}
    </section>
  );
}

function SeasonChart({ races }: { races: RaceEvaluation[] }): ReactNode {
  const points = buildPoints(races);
  const gridValues = [0, 0.5, 1];

  return (
    <div className={styles.chartWrap}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Saison-Chart mit ${races.length} ausgewerteten Rennen`}
      >
        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="#1f2733"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={yFor(v) + 4} textAnchor="end" fontSize={11} fill="#6b7686">
              {v.toFixed(1)}
            </text>
          </g>
        ))}

        {points.length > 1 ? (
          <>
            <polyline
              points={polyline(points, (p) => p.yHit)}
              fill="none"
              stroke="#4ade80"
              strokeWidth={2}
            />
            <polyline
              points={polyline(points, (p) => p.yBrier)}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2}
            />
          </>
        ) : null}

        {points.map((p) => (
          <g key={p.race.round}>
            <circle cx={p.x} cy={p.yHit} r={4} fill="#4ade80" data-testid="hit-point">
              <title>
                {`Runde ${p.race.round} (${p.race.race_date}, Modell v${p.race.model_version}): ` +
                  `Trefferquote ${(p.race.top3_hit_rate * 100).toFixed(0)} % — ` +
                  `Podium ${p.race.actual_top3.map((d) => d.driver_code ?? `#${d.driver_number}`).join(", ")}, ` +
                  `vorhergesagt ${p.race.predicted_top3.map((d) => d.driver_code).join(", ")}`}
              </title>
            </circle>
            <circle cx={p.x} cy={p.yBrier} r={3.5} fill="#f59e0b" data-testid="brier-point">
              <title>{`Runde ${p.race.round}: Brier Score ${p.race.brier_score.toFixed(3)}`}</title>
            </circle>
            <text x={p.x} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="#6b7686">
              R{p.race.round}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
