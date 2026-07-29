"""Keep the bundled history artifact current within a running season (Phase 010).

The history frame published beside a model (`models/<version>/history.csv`) is
what the inference lambda derives the three rolling features from — `driver_form`,
`constructor_form`, `track_history` (see `inference.build_race_features`). The
deployed 0.2.0 artifact ends at round 24 of 2025, so every 2026 prediction was
computed from prior-season form that never moved during the season.

This module is the pure half of the fix: appending finished races to an existing
history frame. The I/O half (fetch from S3, load races via FastF1, upload) lives
in `scripts/refresh_history.py`, so the merge logic is testable without network,
FastF1 or AWS.
"""

import logging

import pandas as pd

from f1pred.data import RACE_COLUMNS

logger = logging.getLogger(__name__)

#: A race row is identified by who drove in which race — the natural key of the
#: history frame and the dedupe key below.
RACE_ROW_KEY = ["year", "round", "driver"]


def _normalized(frame: pd.DataFrame) -> pd.DataFrame:
    """Reindex onto RACE_COLUMNS so both sides of a merge share one shape.

    Raises on a missing column rather than silently filling it: a history frame
    lacking `points` would produce a plausible-looking but wrong form feature
    (Constitution VI — schema drift fails loudly).
    """
    missing = [c for c in RACE_COLUMNS if c not in frame.columns]
    if missing:
        raise ValueError(f"race frame is missing columns: {missing}")
    return frame.loc[:, RACE_COLUMNS]


def append_races(history: pd.DataFrame, new_races: pd.DataFrame) -> pd.DataFrame:
    """Merge finished races into a history frame, newest data winning.

    - Both sides are reindexed onto `RACE_COLUMNS`.
    - Duplicates on `(year, round, driver)` are resolved in favour of
      `new_races`, so re-running after a result was corrected upstream actually
      updates the row instead of leaving a stale one behind.
    - The result is sorted by `(year, round)` with a stable sort, which keeps
      driver order inside a race as delivered.

    Sorting matters beyond tidiness: `features.build_features` derives the
    rolling features from row order via `.shift(1)`, so a history frame appended
    out of order would leak a later race into an earlier one's features. Sorting
    here is what preserves that guarantee (spec AC-10).

    Idempotent (spec AC-9): applying the same `new_races` twice yields an equal
    frame, because dedupe and sort are both deterministic.
    """
    base = _normalized(history)
    incoming = _normalized(new_races)

    if incoming.empty:
        return base.sort_values(["year", "round"], kind="stable").reset_index(drop=True)

    combined = pd.concat([base, incoming], ignore_index=True)
    # keep="last" → the incoming row wins over the one already in history.
    deduped = combined.drop_duplicates(subset=RACE_ROW_KEY, keep="last")

    replaced = len(base) + len(incoming) - len(deduped)
    if replaced:
        logger.info("replaced %d existing history row(s) with fresher data", replaced)

    result = deduped.sort_values(["year", "round"], kind="stable").reset_index(drop=True)
    logger.info(
        "history: %d rows in, %d appended, %d rows out",
        len(base),
        len(result) - len(base),
        len(result),
    )
    return result


def seasons_covered(history: pd.DataFrame) -> list[int]:
    """Sorted distinct seasons in a history frame — used to report what the
    refresh actually changed, and by the CLI's dry-run summary."""
    if history.empty or "year" not in history.columns:
        return []
    return sorted({int(y) for y in history["year"].tolist()})


def latest_round(history: pd.DataFrame, year: int) -> int | None:
    """Highest round present for a season, or None if the season is absent.
    Lets the CLI default to "everything after what we already have"."""
    if history.empty or "year" not in history.columns:
        return None
    season = history[history["year"] == year]
    if season.empty:
        return None
    return int(season["round"].max())
