import type { ReactNode } from "react";

import {
  type ActualSlot,
  diffPredictionVsActual,
  type GridPosition,
  gridTop3Codes,
  hitCount,
} from "../../lib/live-diff";
import styles from "../hub.module.css";

export interface BaselineComparisonProps {
  /** Driver codes of the model's three highest-probability drivers. */
  predictedTop3: string[];
  /** Starting grid of this race, or null when it could not be loaded. */
  grid: GridPosition[] | null;
  /** The actual top-3 — null before the race has a result. */
  finalTop3: ActualSlot[] | null;
}

/**
 * The model against the trivial "podium = started in the top 3" baseline
 * (Phase 010, AC-7).
 *
 * This is deliberately unflattering: measured over rounds 8–11 of 2026 both
 * sat at 7 of 12. Showing it is the point — a model that publishes the
 * baseline it has to beat is more credible than one that shows a 94% bar with
 * no reference, and the same baseline already governs the roll-out gate in the
 * training notebook (`ml/src/f1pred/evaluate.py`).
 *
 * Uses only data the page already loaded — grid, prediction, result — so it
 * costs no additional request (AC-8). Renders nothing before the race has a
 * result, when there is nothing to compare.
 */
export function BaselineComparison({
  predictedTop3,
  grid,
  finalTop3,
}: BaselineComparisonProps): ReactNode {
  const baselineTop3 = gridTop3Codes(grid);
  if (!finalTop3 || finalTop3.length === 0) return null;
  if (predictedTop3.length === 0 || baselineTop3.length === 0) return null;

  const modelHits = hitCount(diffPredictionVsActual(predictedTop3, finalTop3));
  const baselineHits = hitCount(diffPredictionVsActual(baselineTop3, finalTop3));

  return (
    <section className={`card ${styles.col4}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Modell vs. Baseline</h2>
        <span className={styles.panelMeta}>Treffer im Podium</span>
      </div>

      <div className={styles.baselineGrid}>
        <Row label="Modell" codes={predictedTop3} hits={modelHits} />
        <Row label="Startaufstellung" codes={baselineTop3} hits={baselineHits} />
      </div>

      <p className={styles.baselineNote}>
        Die Baseline tippt schlicht die ersten drei der Qualifikation. Über die Runden 8–11 der
        Saison 2026 lagen beide bei 7 von 12 — bei vier Rennen ist das keine belastbare Aussage,
        sondern der ehrliche Zwischenstand.
      </p>
    </section>
  );
}

/** Deliberately uncoloured: a green "hit" tint would read as praise regardless
 * of whether the model actually beat the baseline. */
function Row({ label, codes, hits }: { label: string; codes: string[]; hits: number }): ReactNode {
  return (
    <div className={styles.baselineRow}>
      <span className={styles.baselineLabel}>{label}</span>
      <span className={styles.baselineCodes}>{codes.join(" · ")}</span>
      <span className={`${styles.baselineHits} tnum`}>{hits} von 3</span>
    </div>
  );
}
