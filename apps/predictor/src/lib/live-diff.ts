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
