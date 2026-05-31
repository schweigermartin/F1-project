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
from collections.abc import Callable, Iterable
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

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

    fastf1.Cache.enable_cache(".fastf1-cache")
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    return [int(r) for r in schedule["RoundNumber"].tolist() if int(r) >= 1]


def fastf1_load_race(year: int, rnd: int) -> pd.DataFrame | None:
    """Load + normalize one race (Race + Qualifying + Weather). None on missing data."""
    import fastf1  # noqa: PLC0415

    fastf1.Cache.enable_cache(".fastf1-cache")
    try:
        race = fastf1.get_session(year, rnd, "R")
        race.load(telemetry=False, weather=True, messages=False)
        quali = fastf1.get_session(year, rnd, "Q")
        quali.load(telemetry=False, weather=False, messages=False)
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


def _to_int(value: Any) -> int | None:
    """Coerce a pandas cell (numpy float/int, NaN, str) to int, or None."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
