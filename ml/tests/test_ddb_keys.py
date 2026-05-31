"""DDB key mirror tests — must match @f1/shared/ddb-keys.ts byte-for-byte."""

from f1pred.ddb_keys import explanation_sk, prediction_sk, race_pk


def test_race_pk_zero_pads_round() -> None:
    assert race_pk("2026-06-07", 9) == "race#2026-06-07#09"
    assert race_pk("2026-11-22", 22) == "race#2026-11-22#22"


def test_prediction_sk_zero_pads_driver() -> None:
    assert prediction_sk(1) == "prediction#01"
    assert prediction_sk(44) == "prediction#44"


def test_explanation_sk_mirrors_prediction_sk() -> None:
    assert explanation_sk(1) == "explanation#01"
    assert explanation_sk(44) == "explanation#44"


def test_explanation_sorts_before_prediction_for_a_driver() -> None:
    assert explanation_sk(44) < prediction_sk(44)
