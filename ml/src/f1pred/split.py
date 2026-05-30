"""Temporal train/val/test split — by season year, never random.

A random split would leak future races into training (Constitution IX /
spec AC-3). Train is everything up to `train_max_year`, validation and test are
the two following seasons, strictly after training.
"""

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class Split:
    train: pd.DataFrame
    val: pd.DataFrame
    test: pd.DataFrame


def temporal_split(
    df: pd.DataFrame,
    *,
    train_max_year: int,
    val_year: int,
    test_year: int,
    year_col: str = "year",
) -> Split:
    """Split `df` by `year_col`. Requires train_max_year < val_year < test_year."""
    if not (train_max_year < val_year < test_year):
        raise ValueError(
            f"years must be strictly increasing, got "
            f"train_max={train_max_year}, val={val_year}, test={test_year}"
        )
    year = df[year_col]
    return Split(
        train=df[year <= train_max_year].copy(),
        val=df[year == val_year].copy(),
        test=df[year == test_year].copy(),
    )
