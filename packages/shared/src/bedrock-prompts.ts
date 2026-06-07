import { type ShapContribution } from "./prediction-schema.js";

/**
 * Versioned Bedrock prompt templates for the per-driver podium explanation
 * (Phase 4, AC-2/AC-5). Versioned (Spec R-2) because prompt quality needs
 * iteration — the inference lambda stores `BEDROCK_PROMPT_VERSION` next to the
 * cached text so we can tell which template produced a given explanation and
 * invalidate the cache on a prompt change.
 *
 * Architecture constraint (AC-5): **the LLM explains, it does not predict.**
 * The probability is computed by the XGBoost model and handed to the prompt as
 * a fixed fact; the SHAP contributions say *why*. The system prompt forbids the
 * model from inventing or second-guessing the number.
 *
 * Output language is German (audience: German-speaking F1 fans, cf. the spec
 * examples). Single source of truth — the inference lambda imports these, so a
 * prompt change is one commit, never copy-pasted (Constitution III).
 */
export const BEDROCK_PROMPT_VERSION = "v1" as const;

/** Max sentences the model may produce per driver (AC-2). */
export const MAX_EXPLANATION_SENTENCES = 3;

/**
 * Human-readable German labels for the twelve model features. Used to turn raw
 * SHAP feature names into prose the prompt (and ultimately the fan) can read.
 * Keys are the `PodiumFeatureName` union, so adding a feature without a label
 * is a compile error (Constitution VI). Mirror of `FEATURE_LABELS_DE` in
 * `ml/src/f1pred/bedrock_prompt.py` — the two MUST stay identical.
 */
export const FEATURE_LABELS_DE: Record<ShapContribution["feature"], string> = {
  grid_position: "Startplatz",
  quali_gap_to_pole_s: "Qualifying-Rückstand auf die Pole",
  driver_form: "aktuelle Form des Fahrers",
  constructor_form: "aktuelle Form des Teams",
  track_history: "bisherige Ergebnisse auf dieser Strecke",
  is_wet: "Regen-/Nässebedingungen",
  quali_segment_reached: "erreichtes Qualifying-Segment (Q1/Q2/Q3)",
  quali_grid_delta: "Startplatz-Verschiebung gegenüber dem Qualifying",
  quali_teammate_gap_s: "Qualifying-Rückstand auf den Teamkollegen",
  practice_best_pace_gap_s: "beste Pace im Training",
  practice_long_run_pace_s: "Long-Run-Pace im Training (Renn-Simulation)",
  practice_laps_count: "Trainingsumfang (gefahrene Runden)",
};

/**
 * System prompt: pins the role (explain, never predict — AC-5), the length
 * (≤ 3 sentences — AC-2), the language (German) and the tone. The short example
 * anchors style and length without leaking real numbers into the output.
 */
export const SYSTEM_PROMPT = [
  "Du bist ein Formel-1-Analyst, der eine bereits berechnete Podiums-Wahrscheinlichkeit erklärt.",
  "Die Wahrscheinlichkeit stammt aus einem statistischen Modell, NICHT von dir — du sagst nichts vorher,",
  "du erfindest keine Zahlen und stellst die genannte Wahrscheinlichkeit nicht in Frage.",
  "Begründe sie ausschließlich anhand der dir gelieferten Einflussfaktoren.",
  `Antworte auf Deutsch in höchstens ${MAX_EXPLANATION_SENTENCES} Sätzen, sachlich und ohne Floskeln.`,
  "",
  "Beispiel:",
  "Eingabe: Fahrer VER, Wahrscheinlichkeit 68 %, dafür: Startplatz, aktuelle Form des Fahrers; dagegen: Regen-/Nässebedingungen.",
  "Ausgabe: Verstappens hohe Podiumschance von 68 % stützt sich vor allem auf seinen starken Startplatz und seine aktuelle Form. Erwarteter Regen ist der größte Unsicherheitsfaktor und drückt die Chance leicht.",
].join("\n");

/**
 * Split SHAP contributions into the factors that push the driver toward the
 * podium (positive) and away from it (negative). Order within each group is
 * preserved — the inference side hands `shapTop` already sorted by magnitude.
 */
function splitByDirection(shapTop: ShapContribution[]): { positive: string[]; negative: string[] } {
  const positive: string[] = [];
  const negative: string[] = [];
  for (const { feature, contribution } of shapTop) {
    const label = FEATURE_LABELS_DE[feature];
    if (contribution >= 0) positive.push(label);
    else negative.push(label);
  }
  return { positive, negative };
}

/**
 * Build the structured user prompt for one driver. Deterministic (snapshot-
 * testable): the probability is rendered as a whole-percent fact, the SHAP
 * features as "dafür"/"dagegen" lists in human-readable German.
 *
 * `shapTop` is expected to be the model's top-N contributions (already sorted);
 * an empty list is allowed (the model then explains from the probability alone).
 */
export function buildExplanationPrompt(
  driverCode: string,
  probability: number,
  shapTop: ShapContribution[],
): string {
  const percent = Math.round(probability * 100);
  const { positive, negative } = splitByDirection(shapTop);

  const lines = [
    `Fahrer: ${driverCode}`,
    `Berechnete Podiums-Wahrscheinlichkeit: ${percent} %`,
    `Spricht dafür: ${positive.length > 0 ? positive.join(", ") : "—"}`,
    `Spricht dagegen: ${negative.length > 0 ? negative.join(", ") : "—"}`,
    "",
    `Erkläre diese ${percent} % in höchstens ${MAX_EXPLANATION_SENTENCES} Sätzen.`,
  ];
  return lines.join("\n");
}
