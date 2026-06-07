import pandas as pd
import pytest

from f1pred.data import (
    PRACTICE_LAP_COLUMNS,
    RACE_COLUMNS,
    _practice_best_pace_gap,
    _practice_laps_count,
    _practice_long_run_pace,
    _quali_grid_delta,
    _quali_segment_reached,
    _quali_teammate_gap,
    load_seasons,
)


def _laps(rows: list[tuple[str, float | None, int, bool]]) -> pd.DataFrame:
    """Build a normalized practice-laps frame from (code, lap_time_s, stint, accurate)."""
    return pd.DataFrame(rows, columns=PRACTICE_LAP_COLUMNS)


def _qres() -> pd.DataFrame:
    """A small quali results frame mirroring FastF1's columns (Q1/Q2/Q3 as
    Timedelta/NaT). VER+PER are team-mates; HAM is knocked out in Q2; SAR in Q1."""
    td = pd.to_timedelta
    return pd.DataFrame(
        [
            {"Abbreviation": "VER", "TeamName": "RBR", "Position": 1,
             "Q1": td("0:01:10.1"), "Q2": td("0:01:09.5"), "Q3": td("0:01:09.0")},
            {"Abbreviation": "PER", "TeamName": "RBR", "Position": 4,
             "Q1": td("0:01:10.4"), "Q2": td("0:01:09.9"), "Q3": td("0:01:09.4")},
            {"Abbreviation": "HAM", "TeamName": "MER", "Position": 11,
             "Q1": td("0:01:10.6"), "Q2": td("0:01:10.2"), "Q3": pd.NaT},
            {"Abbreviation": "SAR", "TeamName": "WIL", "Position": 18,
             "Q1": td("0:01:11.3"), "Q2": pd.NaT, "Q3": pd.NaT},
        ]
    )


def _race(year: int, rnd: int) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "year": year,
                "round": rnd,
                "driver": "VER",
                "constructor": "RBR",
                "circuit": "BHR",
                "grid_position": 1,
                "quali_gap_to_pole_s": 0.0,
                "is_wet": False,
                "quali_segment_reached": 3,
                "quali_grid_delta": 0,
                "quali_teammate_gap_s": -0.1,
                "practice_best_pace_gap_s": 0.0,
                "practice_long_run_pace_s": -0.2,
                "practice_laps_count": 60,
                "points": 25.0,
                "finish_position": 1,
            }
        ],
        columns=RACE_COLUMNS,
    )


def test_concatenates_all_loaded_races() -> None:
    out = load_seasons(
        [2024],
        rounds_for_year=lambda _y: [1, 2],
        load_race=lambda y, r: _race(y, r),
    )
    assert out["round"].tolist() == [1, 2]
    assert list(out.columns) == RACE_COLUMNS


def test_skips_rounds_with_no_data() -> None:
    out = load_seasons(
        [2024],
        rounds_for_year=lambda _y: [1, 2, 3],
        load_race=lambda y, r: None if r == 2 else _race(y, r),
    )
    assert out["round"].tolist() == [1, 3]


def test_empty_when_nothing_loads() -> None:
    out = load_seasons(
        [2024],
        rounds_for_year=lambda _y: [1],
        load_race=lambda _y, _r: None,
    )
    assert out.empty
    assert list(out.columns) == RACE_COLUMNS


# ── T2: pure quali helpers ─────────────────────────────────────────────────


def test_segment_reached_uses_highest_segment_with_a_time() -> None:
    q = _qres()
    assert _quali_segment_reached(q, "VER") == 3  # set a Q3 time
    assert _quali_segment_reached(q, "HAM") == 2  # out in Q2
    assert _quali_segment_reached(q, "SAR") == 1  # out in Q1


def test_segment_reached_none_for_unknown_driver() -> None:
    assert _quali_segment_reached(_qres(), "XXX") is None


def test_grid_delta_is_grid_minus_quali() -> None:
    assert _quali_grid_delta(5, 2) == 3  # 3-place grid penalty
    assert _quali_grid_delta(1, 1) == 0
    assert _quali_grid_delta(2, 5) == -3  # gained places (others penalised)


def test_grid_delta_none_when_position_missing() -> None:
    assert _quali_grid_delta(None, 2) is None
    assert _quali_grid_delta(5, None) is None


def test_teammate_gap_is_symmetric_signed_seconds() -> None:
    q = _qres()
    # VER 1:09.0 best vs PER 1:09.4 best → VER 0.4s faster (negative).
    assert _quali_teammate_gap(q, "VER", "RBR") == pytest.approx(-0.4, abs=1e-6)
    assert _quali_teammate_gap(q, "PER", "RBR") == pytest.approx(0.4, abs=1e-6)


def test_teammate_gap_none_without_a_classified_teammate() -> None:
    q = _qres()
    assert _quali_teammate_gap(q, "HAM", "MER") is None  # solo MER entry here


# ── T3: pure practice helpers ──────────────────────────────────────────────


def test_laps_count_counts_all_driver_laps() -> None:
    laps = _laps([("VER", 90.0, 1, True), ("VER", 200.0, 1, False), ("PER", 91.0, 1, True)])
    assert _practice_laps_count(laps, "VER") == 2
    assert _practice_laps_count(laps, "PER") == 1
    assert _practice_laps_count(laps, "XXX") == 0  # did not run


def test_best_pace_gap_is_driver_best_minus_session_best() -> None:
    laps = _laps([("VER", 90.0, 1, True), ("PER", 90.4, 1, True), ("HAM", 90.9, 1, True)])
    assert _practice_best_pace_gap(laps, "VER") == pytest.approx(0.0)  # session-fastest
    assert _practice_best_pace_gap(laps, "PER") == pytest.approx(0.4)


def test_best_pace_gap_ignores_inaccurate_laps() -> None:
    # VER's only fast lap is an out-lap (inaccurate) → falls back to the slow one.
    laps = _laps([("VER", 80.0, 1, False), ("VER", 90.0, 1, True), ("PER", 89.0, 1, True)])
    assert _practice_best_pace_gap(laps, "VER") == pytest.approx(1.0)


def test_best_pace_gap_none_without_accurate_lap() -> None:
    laps = _laps([("VER", 90.0, 1, False), ("PER", 91.0, 1, True)])
    assert _practice_best_pace_gap(laps, "VER") is None


def test_long_run_pace_uses_only_stints_of_min_length() -> None:
    # VER runs a 5-lap stint @ ~91; PER a 5-lap stint @ ~92 → VER ~1s faster than field median.
    ver = [("VER", 91.0 + i * 0.0, 2, True) for i in range(5)]
    per = [("PER", 92.0, 2, True) for _ in range(5)]
    laps = _laps([*ver, *per])
    # field median of {91, 92} = 91.5 → VER 91-91.5 = -0.5, PER 92-91.5 = +0.5
    assert _practice_long_run_pace(laps, "VER") == pytest.approx(-0.5)
    assert _practice_long_run_pace(laps, "PER") == pytest.approx(0.5)


def test_long_run_pace_none_when_no_qualifying_stint() -> None:
    # Only short runs (< MIN_LONG_RUN_LAPS) → no long run for anyone.
    laps = _laps([("VER", 91.0, 1, True), ("VER", 91.1, 1, True), ("PER", 92.0, 1, True)])
    assert _practice_long_run_pace(laps, "VER") is None
