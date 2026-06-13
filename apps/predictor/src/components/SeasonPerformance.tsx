"use client";

import type { RaceEvaluation, SeasonEvaluationResponse } from "@f1/shared";
import { type ReactNode, useState } from "react";

import styles from "./season.module.css";

/**
 * Saison-Performance chart (Phase 5 AC-3 / Phase 7 AC-9): top-3 hit-rate and
 * Brier score per evaluated race. Phase 7 adds a metric toggle and model-
 * version bands (a dashed marker where the active model changed) on top of the
 * dependency-free inline SVG. Tooltips stay native <title>. Empty-state kept.
 */

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 14, right: 14, bottom: 28, left: 34 };

type Metric = "both" | "hit" | "brier";

interface Point {
  x: number;
  yHit: number;
  yBrier: number;
  race: RaceEvaluation;
}

function yFor(value: number): number {
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  return PAD.top + (1 - value) * innerH;
}

function buildPoints(races: RaceEvaluation[]): Point[] {
  const innerW = WIDTH - PAD.left - PAD.right;
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

/** Indices where the model version differs from the previous race → a band. */
function versionBands(points: Point[]): Array<{ x: number; version: string }> {
  const bands: Array<{ x: number; version: string }> = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && prev.race.model_version !== p.race.model_version) {
      bands.push({ x: (prev.x + p.x) / 2, version: p.race.model_version });
    }
  });
  return bands;
}

export interface SeasonPerformanceProps {
  response: SeasonEvaluationResponse | null;
}

export function SeasonPerformance({ response }: SeasonPerformanceProps): ReactNode {
  const [metric, setMetric] = useState<Metric>("both");
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
          <div className={styles.toggle} role="group" aria-label="Metrik wählen">
            <ToggleBtn active={metric === "both"} onClick={() => setMetric("both")}>
              Beide
            </ToggleBtn>
            <ToggleBtn active={metric === "hit"} onClick={() => setMetric("hit")}>
              Trefferquote
            </ToggleBtn>
            <ToggleBtn active={metric === "brier"} onClick={() => setMetric("brier")}>
              Brier
            </ToggleBtn>
          </div>
        ) : null}
      </header>

      {races.length === 0 ? (
        <p className={styles.empty}>
          Noch keine ausgewerteten Rennen — der Chart füllt sich, sobald das erste vorhergesagte
          Rennen gelaufen und ausgewertet ist.
        </p>
      ) : (
        <SeasonChart races={races} metric={metric} />
      )}
    </section>
  );
}

function ToggleBtn({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={`${styles.toggleBtn} ${active ? styles.toggleActive : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SeasonChart({ races, metric }: { races: RaceEvaluation[]; metric: Metric }): ReactNode {
  const points = buildPoints(races);
  const gridValues = [0, 0.5, 1];
  const showHit = metric !== "brier";
  const showBrier = metric !== "hit";
  const bands = versionBands(points);

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

        {/* Model-version bands (Phase 7 AC-9). */}
        {bands.map((b) => (
          <g key={`band-${b.x}`}>
            <line
              x1={b.x}
              x2={b.x}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="#3a4456"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text x={b.x + 3} y={PAD.top + 9} fontSize={9} fill="#8a94a6">
              → v{b.version}
            </text>
          </g>
        ))}

        {points.length > 1 ? (
          <>
            {showHit ? (
              <polyline
                points={polyline(points, (p) => p.yHit)}
                fill="none"
                stroke="#4ade80"
                strokeWidth={2}
              />
            ) : null}
            {showBrier ? (
              <polyline
                points={polyline(points, (p) => p.yBrier)}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={2}
              />
            ) : null}
          </>
        ) : null}

        {points.map((p) => (
          <g key={p.race.round}>
            {showHit ? (
              <circle
                cx={p.x}
                cy={p.yHit}
                r={4}
                fill="#4ade80"
                data-testid="hit-point"
                style={{ opacity: 1 }}
              >
                <title>
                  {`Runde ${p.race.round} (${p.race.race_date}, Modell v${p.race.model_version}): ` +
                    `Trefferquote ${(p.race.top3_hit_rate * 100).toFixed(0)} % — ` +
                    `Podium ${p.race.actual_top3.map((d) => d.driver_code ?? `#${d.driver_number}`).join(", ")}, ` +
                    `vorhergesagt ${p.race.predicted_top3.map((d) => d.driver_code).join(", ")}`}
                </title>
              </circle>
            ) : null}
            {showBrier ? (
              <circle cx={p.x} cy={p.yBrier} r={3.5} fill="#f59e0b" data-testid="brier-point">
                <title>{`Runde ${p.race.round}: Brier Score ${p.race.brier_score.toFixed(3)}`}</title>
              </circle>
            ) : null}
            <text x={p.x} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="#6b7686">
              R{p.race.round}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
