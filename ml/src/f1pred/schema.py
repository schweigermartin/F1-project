"""Feature contract — the single source of feature names, order and ranges.

Shared by training (Phase 3) and inference (Phase 4): the model's input columns
are exactly `FEATURE_NAMES`, in this order. All features are **pre-race known**
(no leakage — Constitution IX / spec R-3).
"""

from pydantic import BaseModel, Field

#: Model input columns, in the exact order the model expects them.
FEATURE_NAMES: tuple[str, ...] = (
    "grid_position",
    "quali_gap_to_pole_s",
    "driver_form",
    "constructor_form",
    "track_history",
    "is_wet",
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
