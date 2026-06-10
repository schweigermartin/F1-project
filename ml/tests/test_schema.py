import pytest
from pydantic import ValidationError

from f1pred.schema import FEATURE_NAMES, PodiumFeatures

VALID = {
    "grid_position": 3,
    "quali_gap_to_pole_s": 0.412,
    "driver_form": 12.5,
    "constructor_form": 20.0,
    "track_history": 4.2,
    "is_wet": False,
    # 0.2.0 additions (Phase 006)
    "quali_segment_reached": 3,
    "quali_grid_delta": -2,
    "quali_teammate_gap_s": -0.118,
    "practice_best_pace_gap_s": 0.35,
    "practice_long_run_pace_s": 0.2,
    "practice_laps_count": 58,
}


def test_feature_names_match_the_model_fields_in_order() -> None:
    assert tuple(PodiumFeatures.model_fields) == FEATURE_NAMES


def test_accepts_a_valid_row() -> None:
    f = PodiumFeatures(**VALID)
    assert f.grid_position == 3


def test_rejects_out_of_range_grid_position() -> None:
    with pytest.raises(ValidationError):
        PodiumFeatures(**{**VALID, "grid_position": 0})


def test_rejects_negative_quali_gap() -> None:
    with pytest.raises(ValidationError):
        PodiumFeatures(**{**VALID, "quali_gap_to_pole_s": -1.0})


def test_rejects_out_of_range_quali_segment() -> None:
    with pytest.raises(ValidationError):
        PodiumFeatures(**{**VALID, "quali_segment_reached": 0})
    with pytest.raises(ValidationError):
        PodiumFeatures(**{**VALID, "quali_segment_reached": 4})


def test_rejects_negative_practice_best_pace_gap() -> None:
    with pytest.raises(ValidationError):
        PodiumFeatures(**{**VALID, "practice_best_pace_gap_s": -0.1})


def test_rejects_negative_practice_laps_count() -> None:
    with pytest.raises(ValidationError):
        PodiumFeatures(**{**VALID, "practice_laps_count": -1})


def test_accepts_signed_teammate_and_long_run_gaps() -> None:
    f = PodiumFeatures(**{**VALID, "quali_teammate_gap_s": 0.3, "practice_long_run_pace_s": -0.4})
    assert f.quali_teammate_gap_s == 0.3
    assert f.practice_long_run_pace_s == -0.4


def test_rejects_unknown_and_missing_fields() -> None:
    with pytest.raises(ValidationError):
        PodiumFeatures(**{**VALID, "surprise": 1})
    incomplete = {k: v for k, v in VALID.items() if k != "grid_position"}
    with pytest.raises(ValidationError):
        PodiumFeatures(**incomplete)
