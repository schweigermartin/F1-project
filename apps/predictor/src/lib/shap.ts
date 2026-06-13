/**
 * Pure helpers for the SHAP waterfall (AC-5). A waterfall walks a running total
 * from 0, each feature contribution stepping it up (toward the podium) or down
 * (away). Kept out of the SVG component so the geometry is unit-tested.
 */

import type { PodiumFeatureName, ShapContribution } from "@f1/shared";

/** Human-readable German labels for all 12 model features (0.1.0 + 0.2.0). */
export const FEATURE_LABELS: Record<PodiumFeatureName, string> = {
  grid_position: "Startplatz",
  quali_gap_to_pole_s: "Quali-Rückstand zur Pole",
  driver_form: "Fahrer-Form",
  constructor_form: "Team-Form",
  track_history: "Strecken-Historie",
  is_wet: "Nässe",
  quali_segment_reached: "Quali-Segment (Q1/2/3)",
  quali_grid_delta: "Quali- vs. Startplatz",
  quali_teammate_gap_s: "Quali-Duell Teamkollege",
  practice_best_pace_gap_s: "Training: beste Pace",
  practice_long_run_pace_s: "Training: Longrun-Pace",
  practice_laps_count: "Trainingsrunden",
};

export interface WaterfallBar {
  feature: PodiumFeatureName;
  label: string;
  contribution: number;
  /** Running total before / after this step (value space). */
  start: number;
  end: number;
}

export interface Waterfall {
  bars: WaterfallBar[];
  /** Shared value-space domain for scaling (includes the 0 baseline). */
  min: number;
  max: number;
}

/**
 * Build a waterfall from SHAP contributions. Bars keep the input order (the
 * API already returns `shap_top` ranked by importance). Domain spans every
 * running total plus 0 so positive and negative steps share one axis.
 */
export function buildWaterfall(contributions: ShapContribution[]): Waterfall {
  let running = 0;
  const values = [0];
  const bars: WaterfallBar[] = contributions.map((c) => {
    const start = running;
    running += c.contribution;
    values.push(running);
    return {
      feature: c.feature,
      label: FEATURE_LABELS[c.feature] ?? c.feature,
      contribution: c.contribution,
      start,
      end: running,
    };
  });
  return { bars, min: Math.min(...values), max: Math.max(...values) };
}
