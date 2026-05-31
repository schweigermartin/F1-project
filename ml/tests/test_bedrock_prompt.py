"""Bedrock prompt mirror tests — must stay in sync with the TS snapshot."""

from f1pred.bedrock_prompt import (
    BEDROCK_PROMPT_VERSION,
    FEATURE_LABELS_DE,
    MAX_EXPLANATION_SENTENCES,
    SYSTEM_PROMPT,
    build_explanation_prompt,
)
from f1pred.inference import ShapContribution
from f1pred.schema import FEATURE_NAMES

SHAP_TOP = [
    ShapContribution("grid_position", 0.31),
    ShapContribution("driver_form", 0.14),
    ShapContribution("is_wet", -0.09),
]


def test_system_prompt_pins_explain_not_predict() -> None:
    assert "NICHT von dir" in SYSTEM_PROMPT
    assert "sagst nichts vorher" in SYSTEM_PROMPT
    assert f"höchstens {MAX_EXPLANATION_SENTENCES} Sätzen" in SYSTEM_PROMPT


def test_feature_labels_cover_every_model_feature() -> None:
    for feature in FEATURE_NAMES:
        assert FEATURE_LABELS_DE[feature]


def test_build_explanation_prompt_matches_the_ts_mirror() -> None:
    # Byte-for-byte equal to the TS snapshot in
    # packages/shared/__tests__/__snapshots__/bedrock-prompts.test.ts.snap
    assert build_explanation_prompt("VER", 0.68, SHAP_TOP) == (
        "Fahrer: VER\n"
        "Berechnete Podiums-Wahrscheinlichkeit: 68 %\n"
        "Spricht dafür: Startplatz, aktuelle Form des Fahrers\n"
        "Spricht dagegen: Regen-/Nässebedingungen\n"
        "\n"
        "Erkläre diese 68 % in höchstens 3 Sätzen."
    )


def test_empty_directions_use_em_dash() -> None:
    prompt = build_explanation_prompt("HAM", 0.15, [])
    assert "Spricht dafür: —" in prompt
    assert "Spricht dagegen: —" in prompt
    assert "15 %" in prompt


def test_percent_rounds_half_up_like_math_round() -> None:
    # 0.665 → 66.5 → 67 (half up), not 66 (Python's banker's rounding).
    assert "67 %" in build_explanation_prompt("X", 0.665, [])


def test_prompt_version_is_v1() -> None:
    assert BEDROCK_PROMPT_VERSION == "v1"
