/**
 * Pure: compare the predicted podium against the actual top-3 (AC-8). A slot is
 * a "hit" if that driver was among the predicted top-3. Code-based so it works
 * for both the live OpenF1 feed (mapped to codes via the predictions) and the
 * final Jolpica result.
 */

export interface ActualSlot {
  position: number;
  code: string | null;
  driverNumber?: number;
}

export interface DiffRow extends ActualSlot {
  hit: boolean;
}

export function diffPredictionVsActual(
  predictedTop3Codes: ReadonlyArray<string>,
  actualTop3: ReadonlyArray<ActualSlot>,
): DiffRow[] {
  const predicted = new Set(predictedTop3Codes);
  return [...actualTop3]
    .sort((a, b) => a.position - b.position)
    .slice(0, 3)
    .map((slot) => ({ ...slot, hit: slot.code !== null && predicted.has(slot.code) }));
}

/** How many of the actual top-3 the model predicted (0–3). */
export function hitCount(rows: ReadonlyArray<DiffRow>): number {
  return rows.filter((r) => r.hit).length;
}

/** Minimal shape of a starting-grid row — structural so this module stays
 * independent of `quali-api` (which owns the fetching). */
export interface GridPosition {
  code: string;
  grid: number;
}

/**
 * The three drivers who started at the front — the trivial "podium = grid ≤ 3"
 * baseline (Phase 010, AC-7). It is the same baseline the training notebook
 * scores the model against (`ml/src/f1pred/evaluate.py:59`), which is the point:
 * the comparison shown to a visitor is the one the model card already uses.
 *
 * Deliberately *not* a second comparison implementation — the resulting codes
 * go through `diffPredictionVsActual`/`hitCount` exactly like the model's
 * prediction does (Constitution III).
 *
 * Rows without a usable grid position are ignored; ties keep input order.
 */
export function gridTop3Codes(grid: ReadonlyArray<GridPosition> | null): string[] {
  if (!grid) return [];
  return [...grid]
    .filter((s) => Number.isFinite(s.grid) && s.grid > 0)
    .sort((a, b) => a.grid - b.grid)
    .slice(0, 3)
    .map((s) => s.code);
}
