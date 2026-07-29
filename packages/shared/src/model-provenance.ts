/**
 * Where a deployed model's numbers come from (Phase 010).
 *
 * The predictor showed a probability and a version badge but never said what
 * the model had actually seen. Two different things matter, and conflating
 * them is what the map prevents:
 *
 *   - `trainedSeasons` — the fold the trees were fitted on. Still 2022–2025.
 *   - `historyThrough` — the last season in the bundled `history.csv`, which
 *     is where the three rolling features (`driver_form`, `constructor_form`,
 *     `track_history`) come from.
 *
 * They can legitimately differ: 0.2.1 is the same fitted model as 0.2.0 with a
 * history extended into 2026, so its form features track the running season
 * while its training window does not. Predictions stored under 0.2.0 keep
 * pointing at the frozen-2025 artifact that produced them, which is why the
 * lookup is per-version rather than a single global statement.
 *
 * This map lives in `@f1/shared` because it is part of the model contract that
 * the model card also documents (Constitution IX) — not a frontend string.
 *
 * Keep in sync with `ml/notebooks/train_podium_model.ipynb` (`FIRST_YEAR`,
 * `TRAIN_MAX_YEAR`, `VAL_YEAR`, `TEST_YEAR`) whenever a version is published.
 */
export interface ModelProvenance {
  /** Seasons the model was fitted and validated on, e.g. "2022–2025". */
  trainedSeasons: string;
  /** Last season present in the bundled history artifact. */
  historyThrough: string;
}

export const MODEL_PROVENANCE: Readonly<Record<string, ModelProvenance>> = {
  "0.1.0": { trainedSeasons: "2022–2025", historyThrough: "2025" },
  "0.2.0": { trainedSeasons: "2022–2025", historyThrough: "2025" },
  // Same fitted model as 0.2.0, history extended through round 11 of 2026
  // (Phase 010). The training window is unchanged — only the rolling form
  // features are current, which is exactly what the disclosure must convey.
  "0.2.1": { trainedSeasons: "2022–2025", historyThrough: "2026" },
};

/**
 * Provenance for a model version, or `null` when the version is unknown.
 *
 * Returning `null` rather than a guessed default is deliberate: a wrong
 * training window stated confidently is worse than none, and it is exactly
 * what would happen if a new model shipped without updating this map.
 */
export function modelProvenance(version: string): ModelProvenance | null {
  // Own-property check, not a plain lookup: `MODEL_PROVENANCE["toString"]`
  // would otherwise resolve to the inherited Object.prototype method and slip
  // past the `?? null`.
  return Object.hasOwn(MODEL_PROVENANCE, version) ? (MODEL_PROVENANCE[version] ?? null) : null;
}
