"""Target label: podium = classified finishing position <= 3.

Non-finishers (DNF/NC → NaN or non-numeric position) are not a podium (0).
Pure + deterministic from the results frame.
"""

import pandas as pd

PODIUM_CUTOFF = 3


def podium_label(results: pd.DataFrame, position_col: str = "position") -> pd.Series:
    """Return a 0/1 podium Series aligned to `results`."""
    pos = pd.to_numeric(results[position_col], errors="coerce")
    return ((pos <= PODIUM_CUTOFF) & pos.notna()).astype(int)
