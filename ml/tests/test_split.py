import pandas as pd
import pytest

from f1pred.split import temporal_split

DF = pd.DataFrame({"year": [2021, 2022, 2023, 2024, 2025, 2025], "v": range(6)})


def test_assigns_rows_to_the_right_split() -> None:
    s = temporal_split(DF, train_max_year=2023, val_year=2024, test_year=2025)
    assert s.train["year"].tolist() == [2021, 2022, 2023]
    assert s.val["year"].tolist() == [2024]
    assert s.test["year"].tolist() == [2025, 2025]


def test_no_test_year_is_at_or_before_any_train_year() -> None:
    s = temporal_split(DF, train_max_year=2023, val_year=2024, test_year=2025)
    assert s.train["year"].max() < s.test["year"].min()
    assert s.train["year"].max() < s.val["year"].min()


def test_rejects_non_increasing_years() -> None:
    with pytest.raises(ValueError, match="strictly increasing"):
        temporal_split(DF, train_max_year=2024, val_year=2024, test_year=2025)


def test_missing_season_yields_empty_frame_not_an_error() -> None:
    s = temporal_split(DF, train_max_year=2022, val_year=2023, test_year=2099)
    assert s.test.empty
