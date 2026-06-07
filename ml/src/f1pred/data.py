"""Data layer — load historical races into the normalized frame features.py wants.

FastF1 is imported lazily inside the default loaders, and the per-race loader +
round lister are injectable, so the orchestration (`load_seasons`) is unit-tested
without any network or FastF1 install. The real FastF1 path runs in the training
notebook (T11/T12), cached in `.fastf1-cache/`.

Normalized race columns (one row per race×driver):
  year, round, driver, constructor, circuit, grid_position,
  quali_gap_to_pole_s, is_wet, points, finish_position
"""

import logging
import math
import os
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

#: FastF1 HTTP cache. Defaults relative to CWD (the notebook runs from `ml/`);
#: read-only filesystems (e.g. Lambda's `/var/task`) override via
#: `FASTF1_CACHE_DIR` to point at a writable dir like `/tmp/.fastf1-cache`.
CACHE_DIR = os.environ.get("FASTF1_CACHE_DIR", ".fastf1-cache")


def _enable_cache() -> None:
    """Enable the FastF1 cache, creating the dir first (FastF1 won't create it)."""
    import fastf1  # noqa: PLC0415 — lazy so the module imports without FastF1

    Path(CACHE_DIR).mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(CACHE_DIR)

RACE_COLUMNS = [
    "year",
    "round",
    "driver",
    "constructor",
    "circuit",
    "grid_position",
    "quali_gap_to_pole_s",
    "is_wet",
    "points",
    "finish_position",
]

#: (year, round) -> normalized race frame, or None if the data isn't available.
LoadRace = Callable[[int, int], pd.DataFrame | None]
#: year -> the round numbers held by FastF1 for that season.
RoundsForYear = Callable[[int], Iterable[int]]


def load_seasons(
    years: Iterable[int],
    *,
    rounds_for_year: RoundsForYear,
    load_race: LoadRace,
) -> pd.DataFrame:
    """Concatenate normalized race frames across seasons; skip + log gaps (R-4)."""
    frames: list[pd.DataFrame] = []
    for year in years:
        for rnd in rounds_for_year(year):
            race = load_race(year, rnd)
            if race is None or race.empty:
                logger.warning("skipping %s round %s: no data", year, rnd)
                continue
            frames.append(race)
    if not frames:
        return pd.DataFrame(columns=RACE_COLUMNS)
    return pd.concat(frames, ignore_index=True)


# ─── Default FastF1-backed loaders (exercised in the real run, not in CI) ──────


def fastf1_rounds_for_year(year: int) -> list[int]:
    """Round numbers of the conventional races in a season (lazy FastF1 import)."""
    import fastf1  # noqa: PLC0415 — lazy so the module imports without FastF1

    _enable_cache()
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    return [int(r) for r in schedule["RoundNumber"].tolist() if int(r) >= 1]


def fastf1_load_race(year: int, rnd: int) -> pd.DataFrame | None:
    """Load + normalize one race (Race + Qualifying + Weather). None on missing data."""
    import fastf1  # noqa: PLC0415
    from fastf1.exceptions import RateLimitExceededError  # noqa: PLC0415

    _enable_cache()
    try:
        race = fastf1.get_session(year, rnd, "R")
        race.load(telemetry=False, weather=True, messages=False)
        quali = fastf1.get_session(year, rnd, "Q")
        quali.load(telemetry=False, weather=False, messages=False)
    except RateLimitExceededError:
        # Transient, not missing data: propagate so the caller can back off and
        # resume from cache rather than silently dropping the round (R-4).
        raise
    except Exception as exc:  # noqa: BLE001 — FastF1 raises broadly on missing data
        logger.warning("FastF1 load failed for %s round %s: %s", year, rnd, exc)
        return None

    results = race.results
    if results is None or len(results) == 0:
        return None

    pole_time = quali.results["Q3"].dropna().min() if quali.results is not None else None
    is_wet = bool(getattr(race, "weather_data", pd.DataFrame()).get("Rainfall", pd.Series()).any())
    circuit = str(race.event["EventName"])

    rows = []
    for _, r in results.iterrows():
        quali_gap = _quali_gap_seconds(quali, r["Abbreviation"], pole_time)
        rows.append(
            {
                "year": year,
                "round": rnd,
                "driver": str(r["Abbreviation"]),
                "constructor": str(r["TeamName"]),
                "circuit": circuit,
                "grid_position": _to_int(r.get("GridPosition")),
                "quali_gap_to_pole_s": quali_gap,
                "is_wet": is_wet,
                "points": float(r.get("Points", 0.0)),
                "finish_position": _to_int(r.get("Position")),
            }
        )
    return pd.DataFrame(rows, columns=RACE_COLUMNS)


def _quali_gap_seconds(quali: Any, abbreviation: str, pole_time: Any) -> float | None:
    qres = getattr(quali, "results", None)
    if qres is None or pole_time is None:
        return None
    row = qres[qres["Abbreviation"] == abbreviation]
    if row.empty:
        return None
    best = row[["Q1", "Q2", "Q3"]].min(axis=1).iloc[0]
    if pd.isna(best):
        return None
    return float((best - pole_time).total_seconds())


def _best_quali_seconds(row: "pd.Series[Any]") -> float | None:
    """Best of a quali row's Q1/Q2/Q3 laps, in seconds. None if no time was set.

    Filters NaT explicitly rather than `Series.min()`: a row sliced across the
    mixed-dtype results frame is object-dtype, where `min()` over Timedelta+NaT
    raises instead of skipping the NaT."""
    secs = [
        t.total_seconds()
        for c in ("Q1", "Q2", "Q3")
        if (t := row.get(c)) is not None and not pd.isna(t)
    ]
    return min(secs) if secs else None


def _quali_segment_reached(qres: pd.DataFrame, abbreviation: str) -> int | None:
    """Highest qualifying segment the driver reached: 3 (Q3), 2 (Q2), 1 (Q1).

    A set time in a segment means the driver took part in it, so the highest
    segment with a lap time is the one reached. Robust to grid penalties — those
    move the *grid*, not the segment reached. None if the driver set no time.
    """
    row = qres[qres["Abbreviation"] == abbreviation]
    if row.empty:
        return None
    r = row.iloc[0]
    for segment, col in ((3, "Q3"), (2, "Q2"), (1, "Q1")):
        if col in r.index and not pd.isna(r[col]):
            return segment
    return None


def _quali_grid_delta(grid_position: int | None, quali_position: int | None) -> int | None:
    """`grid_position - quali_position` (>0 = started further back than qualified,
    i.e. a grid penalty/relegation). None if either position is unknown."""
    if grid_position is None or quali_position is None:
        return None
    return int(grid_position) - int(quali_position)


def _quali_teammate_gap(qres: pd.DataFrame, abbreviation: str, team: str) -> float | None:
    """Best-lap gap to the team-mate in seconds: `driver_best - teammate_best`
    (+ = the driver is slower). Isolates driver pace from car pace. None if no
    team-mate is classified or either driver set no time. With two cars per team
    the gap is symmetric (one driver's + is the other's −)."""
    driver_row = qres[qres["Abbreviation"] == abbreviation]
    if driver_row.empty:
        return None
    driver_best = _best_quali_seconds(driver_row.iloc[0])
    if driver_best is None:
        return None
    mates = qres[(qres["TeamName"] == team) & (qres["Abbreviation"] != abbreviation)]
    mate_bests = [s for _, r in mates.iterrows() if (s := _best_quali_seconds(r)) is not None]
    if not mate_bests:
        return None
    return driver_best - min(mate_bests)


# ── Practice (FP1–FP3) pace helpers ───────────────────────────────────────────
# All operate on a *normalized* practice-laps frame so they're net-free testable;
# the FastF1 loader (T5) flattens raw FP laps into these columns first.

#: Columns a normalized practice-laps frame carries (one row per driver lap).
PRACTICE_LAP_COLUMNS = ["driver_code", "lap_time_s", "stint", "is_accurate"]

#: Minimum accurate laps in a stint to count as a long run (race simulation).
MIN_LONG_RUN_LAPS = 5


def _practice_laps_count(laps: pd.DataFrame, driver_code: str) -> int:
    """Total laps the driver completed (all laps, accurate or not) — a
    reliability/running proxy. 0 if the driver did not run."""
    return int((laps["driver_code"] == driver_code).sum())


def _practice_best_pace_gap(laps: pd.DataFrame, driver_code: str) -> float | None:
    """Driver's fastest accurate lap as a gap to the session best, seconds (>= 0).
    None if the driver set no accurate lap or the session has none (quali-sim proxy)."""
    acc = laps[laps["is_accurate"] & laps["lap_time_s"].notna()]
    if acc.empty:
        return None
    driver = acc[acc["driver_code"] == driver_code]
    if driver.empty:
        return None
    return float(driver["lap_time_s"].min()) - float(acc["lap_time_s"].min())


def _driver_long_run_seconds(laps: pd.DataFrame, driver_code: str) -> float | None:
    """Median of the driver's long-run laps (accurate laps in stints of at least
    MIN_LONG_RUN_LAPS), in seconds. None if the driver has no qualifying stint.
    No fuel/tyre correction (documented simplification, D-8)."""
    d = laps[
        (laps["driver_code"] == driver_code)
        & laps["is_accurate"]
        & laps["lap_time_s"].notna()
    ]
    run_laps: list[float] = []
    for _, stint_laps in d.groupby("stint"):
        if len(stint_laps) >= MIN_LONG_RUN_LAPS:
            run_laps.extend(float(t) for t in stint_laps["lap_time_s"])
    if not run_laps:
        return None
    return float(pd.Series(run_laps).median())


def _practice_long_run_pace(laps: pd.DataFrame, driver_code: str) -> float | None:
    """Driver's long-run median as a gap to the field's long-run median, seconds
    (signed; + = slower). None if the driver has no long run or the field has none."""
    own = _driver_long_run_seconds(laps, driver_code)
    if own is None:
        return None
    field = [
        v
        for code in laps["driver_code"].unique()
        if (v := _driver_long_run_seconds(laps, str(code))) is not None
    ]
    if not field:
        return None
    return own - float(pd.Series(field).median())


def _to_int(value: Any) -> int | None:
    """Coerce a pandas cell (numpy float/int, NaN, str) to int, or None."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
