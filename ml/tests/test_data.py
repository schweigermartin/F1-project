import pandas as pd

from f1pred.data import RACE_COLUMNS, load_seasons


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
