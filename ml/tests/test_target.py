import pandas as pd

from f1pred.target import podium_label


def test_top3_are_podium_rest_are_not() -> None:
    df = pd.DataFrame({"position": [1, 2, 3, 4, 10]})
    assert podium_label(df).tolist() == [1, 1, 1, 0, 0]


def test_non_finishers_are_not_podium() -> None:
    df = pd.DataFrame({"position": [1, None, float("nan")]})
    assert podium_label(df).tolist() == [1, 0, 0]


def test_non_numeric_positions_are_coerced() -> None:
    df = pd.DataFrame({"position": ["1", "2", "NC"]})
    assert podium_label(df).tolist() == [1, 1, 0]


def test_label_is_deterministic() -> None:
    df = pd.DataFrame({"position": [3, 4, 1]})
    assert podium_label(df).tolist() == podium_label(df).tolist()
