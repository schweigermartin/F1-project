"""Feature contract — the single source of feature names, order and ranges.

Shared by training (Phase 3) and inference (Phase 4): the model's input columns
are exactly `FEATURE_NAMES`, in this order. All features are **pre-race known**
(no leakage — Constitution IX / spec R-3).
"""

from pydantic import BaseModel, Field

#: Model input columns, in the exact order the model expects them.
#: The first six are the 0.1.0 set; the trailing six are the 0.2.0 additions
#: (richer quali signal + practice pace — Phase 006). New features go at the end
#: so the column order of the older set is never disturbed.
FEATURE_NAMES: tuple[str, ...] = (
    "grid_position",
    "quali_gap_to_pole_s",
    "driver_form",
    "constructor_form",
    "track_history",
    "is_wet",
    # ── 0.2.0 additions (Phase 006) ──
    "quali_segment_reached",
    "quali_grid_delta",
    "quali_teammate_gap_s",
    "practice_best_pace_gap_s",
    "practice_long_run_pace_s",
    "practice_laps_count",
)


class PodiumFeatures(BaseModel):
    """One row of pre-race features for a (race, driver)."""

    model_config = {"extra": "forbid"}

    #: Starting grid position (1 = pole).
    grid_position: int = Field(ge=1, le=30)
    #: Best qualifying lap gap to pole, in seconds (>= 0).
    quali_gap_to_pole_s: float = Field(ge=0.0)
    #: Rolling driver form (avg points over the previous N races, pre-race).
    driver_form: float
    #: Rolling constructor form (team avg points over the previous N races).
    constructor_form: float
    #: Driver's average finishing position on this circuit in prior seasons.
    track_history: float
    #: Wet-race flag (from session weather/status).
    is_wet: bool

    # ── 0.2.0 additions (Phase 006): all pre-race, from the race's own sessions ──

    #: Highest qualifying segment reached (1 = out in Q1, 2 = Q2, 3 = Q3).
    quali_segment_reached: int = Field(ge=1, le=3)
    #: Grid position minus qualifying position (>0 = grid penalty/relegation).
    quali_grid_delta: int = Field(ge=-30, le=30)
    #: Best-lap gap to the team-mate in qualifying, seconds (signed; + = slower).
    quali_teammate_gap_s: float
    #: Fastest practice lap (FP2/FP3) as gap to the session best, seconds (>= 0).
    practice_best_pace_gap_s: float = Field(ge=0.0)
    #: Long-run (race-sim) pace as gap to the field median, seconds (signed).
    practice_long_run_pace_s: float
    #: Total laps completed across FP1–FP3 (reliability/data-volume proxy).
    practice_laps_count: int = Field(ge=0)
