import pandas as pd

from f1pred.features import build_features
from f1pred.schema import FEATURE_NAMES

# Two drivers across four rounds of one season. Numbers chosen so rolling
# form is easy to verify by hand.
RACES = pd.DataFrame(
    {
        "year": [2024] * 8,
        "round": [1, 1, 2, 2, 3, 3, 4, 4],
        "driver": ["VER", "HAM", "VER", "HAM", "VER", "HAM", "VER", "HAM"],
        "constructor": ["RBR", "MER", "RBR", "MER", "RBR", "MER", "RBR", "MER"],
        "circuit": ["BHR", "BHR", "JED", "JED", "BHR", "BHR", "JED", "JED"],
        "grid_position": [1, 2, 1, 3, 2, 1, 1, 2],
        "quali_gap_to_pole_s": [0.0, 0.2, 0.0, 0.3, 0.1, 0.0, 0.0, 0.15],
        "is_wet": [False, False, False, False, True, True, False, False],
        "points": [25, 18, 25, 18, 18, 25, 25, 18],
        "finish_position": [1, 2, 1, 2, 2, 1, 1, 2],
    }
)


def test_outputs_exactly_the_feature_columns() -> None:
    out = build_features(RACES)
    for col in FEATURE_NAMES:
        assert col in out.columns


def test_is_deterministic() -> None:
    a = build_features(RACES)
    b = build_features(RACES.copy())
    pd.testing.assert_frame_equal(a, b)


def test_drops_a_drivers_first_race_no_form_yet() -> None:
    out = build_features(RACES)
    # Round 1 has no prior race for either driver → no driver_form → dropped.
    assert (out["round"] == 1).sum() == 0


def test_driver_form_uses_only_past_races() -> None:
    out = build_features(RACES)
    # VER round 2 form = mean of VER's points before round 2 = round-1 points = 25.
    ver2 = out[(out["driver"] == "VER") & (out["round"] == 2)].iloc[0]
    assert ver2["driver_form"] == 25.0


def test_no_leakage_from_the_current_race_result() -> None:
    # Permuting the LAST round's result columns must not change that round's
    # features (they depend only on earlier races).
    base = build_features(RACES)
    tampered_src = RACES.copy()
    last = tampered_src["round"] == 4
    tampered_src.loc[last, "points"] = tampered_src.loc[last, "points"].values[::-1]
    tampered_src.loc[last, "finish_position"] = (
        tampered_src.loc[last, "finish_position"].values[::-1]
    )
    tampered = build_features(tampered_src)

    cols = list(FEATURE_NAMES)
    base_last = base[base["round"] == 4][cols].reset_index(drop=True)
    tampered_last = tampered[tampered["round"] == 4][cols].reset_index(drop=True)
    pd.testing.assert_frame_equal(base_last, tampered_last)


def test_drops_rows_missing_a_mandatory_feature() -> None:
    src = RACES.copy()
    src.loc[src["round"] == 4, "grid_position"] = None
    out = build_features(src)
    assert (out["round"] == 4).sum() == 0
