# Spec: ML Model

> **Phase:** 003
> **Status:** stub — vollständig ausarbeiten nach Phase 2 done
> **Owner:** Martin

## Problem / Motivation

Kern von Projekt 1. Liefert ein trainiertes, evaluiertes Modell, das Podium-Wahrscheinlichkeiten pro Fahrer und Rennen schätzt. Demonstriert Feature Engineering, Modellwahl und Evaluation — der klassische ML-Skill-Beweis.

## User Stories

- **US-1:** Als ML-Reviewer möchte ich ein Notebook sehen, das den gesamten Trainingsprozess (Daten, Features, Modell, Eval) reproduzierbar zeigt.
- **US-2:** Als Phase-4-Inference möchte ich ein Modell-Artefakt aus S3 laden können, das versioniert ist und einen Model-Card hat.
- **US-3:** Als ML-Reviewer möchte ich Feature-Importance (SHAP) sehen, um zu verstehen, warum das Modell entscheidet.

## Acceptance Criteria

- **AC-1:** Trainingsdaten kommen aus FastF1 (historische Saisons) + S3-Archiv aus Phase 1, falls verfügbar.
- **AC-2:** Mindestens 5 Features sind dokumentiert und begründet (Quali-Pace-Delta, Startposition, Strecken-Historie, Reifenstrategie, Wetter, Constructor-Form — wähle 5+).
- **AC-3:** Modell wird mit XGBoost oder LightGBM trainiert. Train/Val/Test-Split ist zeitlich (kein Random — sonst Leakage).
- **AC-4:** Evaluation berichtet Accuracy, Log-Loss, Kalibrierungs-Plot, Konfusionsmatrix.
- **AC-5:** SHAP-Plot pro Vorhersage UND globaler Feature-Importance-Plot.
- **AC-6:** Modell-Artefakt liegt in `s3://<bucket>/models/<semver>/model.json` (oder `.bin` je nach Library), daneben `model_card.md`.
- **AC-7:** Notebook + Random-Seed → gleicher Score bei Re-Run (Reproduzierbarkeit, Constitution IX).
- **AC-8:** Training läuft lokal in < 10 Min auf normaler Hardware.

## Out of Scope

- Inference-Endpoint (Phase 4).
- Live-Daten-Integration ins Training (Phase 5).
- Deep Learning / Transformer (Gradient Boosting passt zu Tabellendaten).

## Risks & Open Questions

- **R-1:** FastF1 Cache wird groß — Cache-Strategie definieren.
- **R-2:** Klassen-Imbalance (Podium = 3/20 Fahrer ≈ 15%) — Sampling-Strategie vs. Class-Weights.
- **Q-1:** Ziel-Variable: "Podium ja/nein" (Binary) oder "Position 1/2/3/sonst" (Multi-Class)? Empfehlung: Binary für ersten Wurf, weil leichter zu evaluieren.

## Dependencies

- Phase 1 abgeschlossen (S3-Bucket existiert für Modell-Upload).
- Python ≥ 3.12, FastF1, pandas, scikit-learn, xgboost (oder lightgbm), shap.

## Definition of Done

- Notebook committed in `ml/notebooks/`.
- Modell-Artefakt + Model-Card in S3.
- Metriken im Notebook prominent dargestellt (vergleichbar mit Baseline = "immer die ersten 3 Quali-Plätze").
- README erwähnt das Modell + Score.
- Spec-Status: `ML Model → done`.
