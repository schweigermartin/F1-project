import pandas as pd
import pytest

from f1pred.data import RACE_COLUMNS
from f1pred.features import build_features
from f1pred.history import append_races, latest_round, seasons_covered


def race_rows(year: int, rnd: int, *, points: tuple[float, float] = (25.0, 18.0)) -> pd.DataFrame:
    """Two drivers of one race, shaped like a normalized RACE_COLUMNS frame."""
    return pd.DataFrame(
        {
            "year": [year, year],
            "round": [rnd, rnd],
            "driver": ["VER", "HAM"],
            "constructor": ["RBR", "MER"],
            "circuit": ["BHR", "BHR"],
            "grid_position": [1, 2],
            "quali_gap_to_pole_s": [0.0, 0.2],
            "is_wet": [False, False],
            "quali_segment_reached": [3, 3],
            "quali_grid_delta": [0, 0],
            "quali_teammate_gap_s": [-0.2, 0.2],
            "practice_best_pace_gap_s": [0.0, 0.3],
            "practice_long_run_pace_s": [-0.3, 0.3],
            "practice_laps_count": [60, 58],
            "points": list(points),
            "finish_position": [1.0, 2.0],
        },
        columns=RACE_COLUMNS,
    )


def history_2025() -> pd.DataFrame:
    return pd.concat([race_rows(2025, r) for r in (1, 2, 3)], ignore_index=True)


def test_appends_new_races_to_the_end() -> None:
    out = append_races(history_2025(), race_rows(2026, 1))
    assert len(out) == 8
    assert seasons_covered(out) == [2025, 2026]
    assert out.iloc[-1]["year"] == 2026


def test_is_idempotent() -> None:
    """AC-9: applying the same races twice must not duplicate or reorder rows."""
    once = append_races(history_2025(), race_rows(2026, 1))
    twice = append_races(once, race_rows(2026, 1))
    pd.testing.assert_frame_equal(once, twice)


def test_fresher_data_replaces_an_existing_row() -> None:
    corrected = race_rows(2025, 2, points=(0.0, 25.0))  # e.g. a post-race penalty
    out = append_races(history_2025(), corrected)

    assert len(out) == 6  # replaced, not appended
    row = out[(out["year"] == 2025) & (out["round"] == 2) & (out["driver"] == "VER")]
    assert row["points"].iloc[0] == 0.0


def test_sorts_by_year_and_round_even_when_fed_out_of_order() -> None:
    unordered = pd.concat([race_rows(2026, 3), race_rows(2026, 1)], ignore_index=True)
    out = append_races(history_2025(), unordered)
    assert out["round"].tolist() == [1, 1, 2, 2, 3, 3, 1, 1, 3, 3]
    assert out["year"].tolist() == [2025] * 6 + [2026] * 4


def test_empty_incoming_leaves_history_intact_but_sorted() -> None:
    empty = pd.DataFrame(columns=RACE_COLUMNS)
    out = append_races(history_2025(), empty)
    pd.testing.assert_frame_equal(out, history_2025())


def test_missing_column_fails_loudly() -> None:
    broken = race_rows(2026, 1).drop(columns=["points"])
    with pytest.raises(ValueError, match="missing columns"):
        append_races(history_2025(), broken)


def test_extending_history_does_not_change_earlier_races_features() -> None:
    """AC-10: the .shift(1) no-leakage guarantee survives an in-season append.

    Features of races already in the history must be byte-identical before and
    after a later race is appended — otherwise a future result would be leaking
    backwards into an earlier race's rolling form.
    """
    base = history_2025()
    extended = append_races(base, race_rows(2026, 1))

    before = build_features(base)
    after = build_features(extended)

    # Restrict the extended result to the races the base already had.
    after_2025 = after[after["year"] == 2025].reset_index(drop=True)
    pd.testing.assert_frame_equal(before.reset_index(drop=True), after_2025)


def test_latest_round_reports_where_a_season_stopped() -> None:
    hist = history_2025()
    assert latest_round(hist, 2025) == 3
    assert latest_round(hist, 2026) is None
    assert latest_round(pd.DataFrame(columns=RACE_COLUMNS), 2025) is None


def test_seasons_covered_of_an_empty_frame() -> None:
    assert seasons_covered(pd.DataFrame(columns=RACE_COLUMNS)) == []
