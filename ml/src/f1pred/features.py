"""Pre-race feature pipeline.

Builds the six `FEATURE_NAMES` columns per (race, driver). Three are passed
through from the data layer (grid_position, quali_gap_to_pole_s, is_wet); three
are rolling/historical aggregates of **past** races only:

  driver_form       avg points over the driver's previous races (shifted)
  constructor_form  avg points over the team's previous races (shifted)
  track_history     avg finish position at this circuit in prior races (shifted)

The `.shift(1)` is the no-leakage guarantee (Constitution IX / spec R-3): a
race's own result never enters its own features.

Missing-feature policy:
  - driver_form / constructor_form NaN (a driver's/team's very first race → no
    history at all) → row dropped; there's genuinely no signal.
  - track_history NaN (first visit to a circuit) → filled with a fixed neutral
    constant. Dropping every first circuit visit would decimate the data
    (rookies, new tracks); the constant carries no data dependency, so no
    leakage. "First visit" is a valid state, not a defect.
"""

import pandas as pd

from f1pred.schema import FEATURE_NAMES

ROLLING_WINDOW = 5

#: Neutral fill for a driver's first visit to a circuit (~midfield of a 20-grid).
NEUTRAL_TRACK_HISTORY = 10.0

_KEYS = ["year", "round", "driver", "constructor", "circuit"]
#: Missing here means "no signal" → drop the row. track_history is filled instead.
_DROP_IF_MISSING = [c for c in FEATURE_NAMES if c != "track_history"]


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
    df["track_history"] = df["track_history"].fillna(NEUTRAL_TRACK_HISTORY)

    out = df.loc[:, _KEYS + list(FEATURE_NAMES)]
    return out.dropna(subset=_DROP_IF_MISSING).sort_index()
