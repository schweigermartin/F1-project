"""F1 podium predictor (Phase 3).

A small, leakage-safe pipeline: FastF1 history -> pre-race features ->
temporal split -> XGBoost -> evaluation + SHAP -> versioned S3 artifact.
See specs/003-ml-model for the spec, plan and tasks.
"""

__version__ = "0.0.0"
