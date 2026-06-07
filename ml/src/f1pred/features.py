"""Pre-race feature pipeline.

Builds the six `FEATURE_NAMES` columns per (race, driver). Three are passed
through from the data layer (grid_position, quali_gap_to_pole_s, is_wet); three
are rolling/historical aggregates of **past** races only:

  driver_form       avg points over the driver's previous races (shifted)
  constructor_form  avg points over the team's previous races (shifted)
  track_history     avg finish position at this circuit in prior races (shifted)

The `.shift(1)` is the no-leakage guarantee (Constitution IX / spec R-3): a
race's own result never enters its own features.

The six 0.2.0 features (quali segment/grid-delta/teammate gap + practice best
pace/long run/laps) are **pre-race passthrough** — they come straight from the
race's own qualifying/practice sessions (computed in data.py), so they need no
`.shift` and are simply carried through here.

Missing-feature policy — each feature is either dropped (no signal) or filled
(a valid "absent" state with no data dependency, so no leakage):
  - DROP if missing: grid_position / quali_gap_to_pole_s / is_wet / driver_form /
    constructor_form (a driver's/team's very first race → no history) and the two
    mandatory quali features (quali_segment_reached, quali_grid_delta) — no
    qualifying means no signal.
  - FILL if missing (constant, no data dependency):
    - track_history (first circuit visit) → NEUTRAL_TRACK_HISTORY.
    - quali_teammate_gap_s (no classified team-mate) → 0 (treat as on-par).
    - practice_best_pace_gap_s → NEUTRAL_PRACTICE_PACE_GAP, practice_long_run_pace_s
      → NEUTRAL_LONG_RUN_GAP (no/short practice, e.g. wet FP or pre-2019 data).
    - practice_laps_count → 0 (didn't run is a valid state, not a defect).
"""

import pandas as pd

from f1pred.schema import FEATURE_NAMES

ROLLING_WINDOW = 5

#: Neutral fill for a driver's first visit to a circuit (~midfield of a 20-grid).
NEUTRAL_TRACK_HISTORY = 10.0
#: Neutral fill (s) for missing practice best-pace gap — ~1s off the best is an
#: unremarkable midfield gap; carries no data dependency (D-6).
NEUTRAL_PRACTICE_PACE_GAP = 1.0
#: Neutral fill (s) for missing long-run pace — 0 = exactly on the field median.
NEUTRAL_LONG_RUN_GAP = 0.0
#: Neutral fill (s) for a missing team-mate gap — 0 = on par with the (absent) mate.
NEUTRAL_TEAMMATE_GAP = 0.0

_KEYS = ["year", "round", "driver", "constructor", "circuit"]

#: Features filled with a neutral constant when missing (absent ≠ no-signal).
_FILLS: dict[str, float] = {
    "track_history": NEUTRAL_TRACK_HISTORY,
    "quali_teammate_gap_s": NEUTRAL_TEAMMATE_GAP,
    "practice_best_pace_gap_s": NEUTRAL_PRACTICE_PACE_GAP,
    "practice_long_run_pace_s": NEUTRAL_LONG_RUN_GAP,
    "practice_laps_count": 0.0,
}
#: Everything else is mandatory: missing means "no signal" → drop the row.
_DROP_IF_MISSING = [c for c in FEATURE_NAMES if c not in _FILLS]


def build_features(races: pd.DataFrame, *, window: int = ROLLING_WINDOW) -> pd.DataFrame:
    """Return keys + FEATURE_NAMES, chronologically derived and leakage-free.

    `races` needs: year, round, driver, constructor, circuit, grid_position,
    quali_gap_to_pole_s, is_wet, points, finish_position. The frame's index is
    preserved so a caller can align the target (podium_label) to it.
    """
    df = races.sort_values(["year", "round"], kind="stable")

    df["driver_form"] = df.groupby("driver")["points"].transform(
        lambda s: s.shift(1).rolling(window, min_periods=1).mean()
    )
    df["constructor_form"] = df.groupby("constructor")["points"].transform(
        lambda s: s.shift(1).rolling(window, min_periods=1).mean()
    )
    df["track_history"] = df.groupby(["driver", "circuit"])["finish_position"].transform(
        lambda s: s.shift(1).expanding().mean()
    )

    # The 0.2.0 passthrough features are expected as input columns; fill the
    # neutral-constant ones (track_history + quali_teammate_gap + practice) so a
    # valid "absent" state survives instead of being dropped.
    for col, fill in _FILLS.items():
        df[col] = df[col].fillna(fill)

    out = df.loc[:, _KEYS + list(FEATURE_NAMES)]
    return out.dropna(subset=_DROP_IF_MISSING).sort_index()
