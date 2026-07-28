/**
 * Podium probability normalisation (Phase 010).
 *
 * The model scores every driver as an independent binary problem
 * (`predict_proba(...)[:, 1]` per row in `ml/src/f1pred/inference.py`), so
 * nothing in the pipeline knows that a race has exactly three podium slots.
 * Measured on the live Read-API (spec 010 §Problem), the per-race sum came out
 * at 4.94–5.83 instead of 3.00, with five to six drivers above 50%.
 *
 * This module applies the missing constraint on the read path. It is a
 * **normalisation onto a known constraint, not a learned calibration** — Platt
 * / isotonic / beta fitting needs a holdout fold and is explicitly out of scope
 * for this phase. The UI must word it the same way ("auf drei Plätze normiert").
 */

/** A race has three podium slots — the constraint the model never sees. */
export const PODIUM_SLOTS = 3;

/** Keeps `logit` finite for probabilities that arrive as exactly 0 or 1. */
const EPS = 1e-12;

/**
 * Bisection bounds for the logit shift. `logit(EPS) ≈ -27.6`, so ±100 brackets
 * every reachable sum with a wide margin in both directions.
 */
const SHIFT_LO = -100;
const SHIFT_HI = 100;

const TOLERANCE = 1e-9;
const MAX_ITERATIONS = 200;

function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - EPS, Math.max(EPS, p));
}

function logit(p: number): number {
  const c = clampProbability(p);
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  // Branch on the sign to avoid overflow in `exp` for large |z|.
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * Rescale per-driver podium probabilities so they sum to `slots`.
 *
 * Finds the single additive shift `b` in log-odds space with
 * `Σ σ(logit(pᵢ) + b) = slots` and returns `σ(logit(pᵢ) + b)`.
 *
 * Why a shift and not a temperature: `σ(α·logit(p))` drives every probability
 * above 0.5 towards 1 and every one below towards 0 as `α` grows, so its sum
 * converges to `#{pᵢ > 0.5}` — six in round 8, which can never reach three. A
 * shift, by contrast, is strictly monotone in `b` over the *whole* range
 * (0 → n), so the target is always bracketed and the root unique.
 *
 * Why a shift is the *right* correction rather than merely a sufficient one:
 * training sets `scale_pos_weight = neg/pos` to counter the ~15% class
 * imbalance (`ml/src/f1pred/train.py`). Weighting the positive class shifts a
 * logistic model's **intercept** by roughly `log(neg/pos)` — a constant offset
 * on all log-odds. Undoing it is exactly a constant offset on all log-odds.
 *
 * Guarantees (spec AC-1..AC-3):
 * - the returned values sum to `slots` (within `TOLERANCE`) whenever `n > slots`
 * - order is preserved exactly — one shared shift through a strictly monotone σ
 * - every value lies in [0, 1]
 *
 * Naive proportional scaling (`pᵢ · slots / Σp`) is rejected: it hits the sum
 * but can produce values above 1 for a dominant field, violating AC-3.
 *
 * @param probabilities raw per-driver probabilities, any order
 * @param slots podium slots to distribute (default 3)
 * @returns normalised probabilities, positionally aligned with the input
 */
export function normalizePodiumProbabilities(
  probabilities: readonly number[],
  slots: number = PODIUM_SLOTS,
): number[] {
  const n = probabilities.length;
  if (n === 0) return [];

  // With no more drivers than slots everyone finishes on the podium. The sum
  // cannot reach `slots` at any shift, so 1.0 is the correct saturation rather
  // than a bisection that would run to its upper bound.
  if (n <= slots) return probabilities.map(() => 1);

  const logits = probabilities.map(logit);
  const sumAt = (shift: number): number =>
    logits.reduce((acc, z) => acc + sigmoid(z + shift), 0);

  let lo = SHIFT_LO;
  let hi = SHIFT_HI;
  let mid = 0;
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    mid = (lo + hi) / 2;
    const sum = sumAt(mid);
    if (Math.abs(sum - slots) < TOLERANCE) break;
    // The sum is strictly increasing in the shift.
    if (sum < slots) lo = mid;
    else hi = mid;
  }

  return logits.map((z) => Math.min(1, Math.max(0, sigmoid(z + mid))));
}

/** The subset of a prediction row this module needs — keeps it decoupled from
 * the full `PredictionWithExplanation` shape. */
export interface NormalizableDriver {
  podium_probability: number;
  podium_probability_normalized?: number | undefined;
}

/**
 * The probability the UI should display and sort by: the normalised value when
 * the API supplied one, the raw model output otherwise.
 *
 * The fallback is what makes the deploy order irrelevant (spec AC-5): the
 * Read-API (Lambda) and the frontend (Vercel) ship separately, so a frontend
 * can legitimately meet a response that predates the new field.
 */
export function effectivePodiumProbability(driver: NormalizableDriver): number {
  return driver.podium_probability_normalized ?? driver.podium_probability;
}
