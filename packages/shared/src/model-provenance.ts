/**
 * Where a deployed model's numbers come from (Phase 010).
 *
 * The predictor showed a probability and a version badge but never said what
 * the model had actually seen. That matters more than usual right now: the
 * artifact deployed as 0.2.0 ships a `history.csv` ending at round 24 of 2025
 * (verified against `s3://…/models/0.2.0/history.csv`), and the three rolling
 * features — `driver_form`, `constructor_form`, `track_history` — are derived
 * from it. For a 2026 race they are therefore prior-season values that do not
 * move during the season, while 2026 is the largest regulation change in the
 * sport's history.
 *
 * That limitation is real, so the UI states it instead of hiding it. This map
 * lives in `@f1/shared` because it is part of the model contract that the
 * model card also documents (Constitution IX) — not a frontend string.
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
