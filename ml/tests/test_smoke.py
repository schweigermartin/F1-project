"""Smoke test so the suite is non-empty from T1 (pytest exits 5 with no tests)."""

import f1pred


def test_package_exposes_a_version() -> None:
    assert isinstance(f1pred.__version__, str)
    assert f1pred.__version__
