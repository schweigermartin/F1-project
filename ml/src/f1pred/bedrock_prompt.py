"""Bedrock explanation prompt — Python mirror of `@f1/shared/bedrock-prompts.ts`.

The inference lambda is Python, so it cannot import the TypeScript template; this
module mirrors it verbatim (same cross-language pattern as `layout.py` ↔
`s3-layout.ts`). The two MUST stay in sync — the output text drives Bedrock and
`BEDROCK_PROMPT_VERSION` is what a cache invalidation would key on (Spec R-2).

Architecture constraint (AC-5): the LLM explains, it does not predict. The
probability is a fixed fact handed in; the SHAP contributions say *why*.
"""

import math
from collections.abc import Sequence

from f1pred.inference import ShapContribution

#: Keep in sync with BEDROCK_PROMPT_VERSION in @f1/shared/bedrock-prompts.ts.
BEDROCK_PROMPT_VERSION = "v1"

#: Max sentences the model may produce per driver (AC-2).
MAX_EXPLANATION_SENTENCES = 3

#: Human-readable German labels for the twelve model features (mirror of the TS
#: FEATURE_LABELS_DE in bedrock-prompts.ts — the two MUST stay identical).
FEATURE_LABELS_DE: dict[str, str] = {
    "grid_position": "Startplatz",
    "quali_gap_to_pole_s": "Qualifying-Rückstand auf die Pole",
    "driver_form": "aktuelle Form des Fahrers",
    "constructor_form": "aktuelle Form des Teams",
    "track_history": "bisherige Ergebnisse auf dieser Strecke",
    "is_wet": "Regen-/Nässebedingungen",
    "quali_segment_reached": "erreichtes Qualifying-Segment (Q1/Q2/Q3)",
    "quali_grid_delta": "Startplatz-Verschiebung gegenüber dem Qualifying",
    "quali_teammate_gap_s": "Qualifying-Rückstand auf den Teamkollegen",
    "practice_best_pace_gap_s": "beste Pace im Training",
    "practice_long_run_pace_s": "Long-Run-Pace im Training (Renn-Simulation)",
    "practice_laps_count": "Trainingsumfang (gefahrene Runden)",
}

# Verbatim mirror of the TS template — kept on single lines (noqa: E501) so the
# byte-for-byte parity with bedrock-prompts.ts stays obvious in review.
SYSTEM_PROMPT = "\n".join(
    [
        "Du bist ein Formel-1-Analyst, der eine bereits berechnete Podiums-Wahrscheinlichkeit erklärt.",  # noqa: E501
        "Die Wahrscheinlichkeit stammt aus einem statistischen Modell, NICHT von dir — du sagst nichts vorher,",  # noqa: E501
        "du erfindest keine Zahlen und stellst die genannte Wahrscheinlichkeit nicht in Frage.",
        "Begründe sie ausschließlich anhand der dir gelieferten Einflussfaktoren.",
        f"Antworte auf Deutsch in höchstens {MAX_EXPLANATION_SENTENCES} Sätzen, sachlich und ohne Floskeln.",  # noqa: E501
        "",
        "Beispiel:",
        "Eingabe: Fahrer VER, Wahrscheinlichkeit 68 %, dafür: Startplatz, aktuelle Form des Fahrers; dagegen: Regen-/Nässebedingungen.",  # noqa: E501
        "Ausgabe: Verstappens hohe Podiumschance von 68 % stützt sich vor allem auf seinen starken Startplatz und seine aktuelle Form. Erwarteter Regen ist der größte Unsicherheitsfaktor und drückt die Chance leicht.",  # noqa: E501
    ]
)


def _percent(probability: float) -> int:
    """Whole-percent, rounding half up to match the TS `Math.round` exactly."""
    return math.floor(probability * 100 + 0.5)


def build_explanation_prompt(
    driver_code: str, probability: float, shap_top: Sequence[ShapContribution]
) -> str:
    """Build the structured user prompt for one driver (mirror of the TS).

    Deterministic: the probability is rendered as a whole-percent fact and the
    SHAP features as "dafür"/"dagegen" lists in human-readable German.
    """
    percent = _percent(probability)
    positive = [FEATURE_LABELS_DE[c.feature] for c in shap_top if c.contribution >= 0]
    negative = [FEATURE_LABELS_DE[c.feature] for c in shap_top if c.contribution < 0]

    lines = [
        f"Fahrer: {driver_code}",
        f"Berechnete Podiums-Wahrscheinlichkeit: {percent} %",
        f"Spricht dafür: {', '.join(positive) if positive else '—'}",
        f"Spricht dagegen: {', '.join(negative) if negative else '—'}",
        "",
        f"Erkläre diese {percent} % in höchstens {MAX_EXPLANATION_SENTENCES} Sätzen.",
    ]
    return "\n".join(lines)
