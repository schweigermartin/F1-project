"""F1Predictions DDB key helpers — Python mirror of `@f1/shared/ddb-keys.ts`.

The inference lambda is Python and can't import the TS helpers; this mirrors the
prediction-table keys verbatim (same cross-language pattern as `layout.py` ↔
`s3-layout.ts`). Keep in sync: a drift here writes rows the Read-API can't find.

  PK = race#<date>#<round>     SK = prediction#<NN> | explanation#<NN>

Driver/round numbers are zero-padded to 2 digits (F1 numbers 1–99, rounds 1–24)
so range scans and lexical SK order stay sorted.
"""

RACE_PK_PREFIX = "race"


def race_pk(date: str, round_number: int) -> str:
    return f"{RACE_PK_PREFIX}#{date}#{round_number:02d}"


def prediction_sk(driver_number: int) -> str:
    return f"prediction#{driver_number:02d}"


def explanation_sk(driver_number: int) -> str:
    return f"explanation#{driver_number:02d}"
