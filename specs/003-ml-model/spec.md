# Spec: ML Model

> **Phase:** 003
> **Status:** spec-ready
> **Owner:** Martin
> **Constitution:** alle Artikel — besonders IX (versionierte Artefakte, reproduzierbare Läufe), VI (Typsicherheit + Validierung), X (Tests für die Feature-Pipeline), IV (Kosten).

## Problem / Motivation

Kern von Projekt 2 (Race Outcome Predictor). Liefert ein trainiertes, evaluiertes Modell, das **Podium-Wahrscheinlichkeiten pro Fahrer und Rennen** schätzt — der klassische ML-Skill-Beweis (Feature Engineering, Modellwahl, leakage-freie Evaluation). Unabhängig vom Phase-2-Dashboard: hängt nur am Phase-1-S3-Bucket (Artefakt-Upload) und an externen FastF1-Historiendaten.

## User Stories

- **US-1:** Als ML-Reviewer möchte ich ein Notebook sehen, das den gesamten Trainingsprozess (Daten → Features → Modell → Eval) reproduzierbar zeigt.
- **US-2:** Als Phase-4-Inference möchte ich ein versioniertes Modell-Artefakt mit Model-Card aus S3 laden können.
- **US-3:** Als ML-Reviewer möchte ich globale **und** per-Vorhersage-Feature-Importance (SHAP) sehen, um die Entscheidungen zu verstehen.

## Acceptance Criteria

EARS-Stil, beobachtbar/prüfbar.

- **AC-1:** Trainingsdaten kommen aus FastF1 (historische Saisons); das Phase-1-S3-Archiv kann ergänzen, falls verfügbar.
- **AC-2:** Mindestens 5 **pre-race-bekannte** Features sind dokumentiert + begründet (Startposition, Quali-Pace-Delta, Fahrer-Form, Constructor-Form, Strecken-Historie, Regen-Flag). Keine während des Rennens entstehenden Größen (kein Leakage).
- **AC-3:** Ziel ist **binär** (`podium = Endposition ≤ 3`). Train/Val/Test-Split ist **zeitlich** (nach Saison/Datum, kein Random).
- **AC-4:** Das Modell wird mit **XGBoost** trainiert; Klassen-Imbalance (~15 % Podium) wird über `scale_pos_weight` (Class-Weights) behandelt, nicht über Resampling.
- **AC-5:** Evaluation berichtet Accuracy, Log-Loss, ROC-AUC, Kalibrierungs-Plot und Konfusionsmatrix — **gegen eine Baseline** („Podium = Startplätze 1–3").
- **AC-6:** SHAP: ein globaler Feature-Importance-Plot **und** mindestens ein per-Vorhersage-Plot.
- **AC-7:** Das Artefakt liegt unter `s3://<bucket>/models/<semver>/model.json` (XGBoost-native JSON), daneben `model_card.md` (Daten, Features, Metriken, Limitations).
- **AC-8:** Fixierter Seed + gepinnte Datenversion → **gleicher Score bei Re-Run** (Reproduzierbarkeit, Constitution IX).
- **AC-9:** Training läuft lokal in < 10 Min auf normaler Hardware.

## Out of Scope

- Inference-Endpoint (Phase 4).
- Live-Daten ins Training / Re-Training-Loop (Phase 5).
- Deep Learning / Transformer (Gradient Boosting passt zu Tabellendaten).
- Hyperparameter-Großsuche — ein vernünftiges, dokumentiertes Set genügt für den ersten Wurf.

## Resolved Decisions

- **Q-1 (Ziel-Variable): binär** `podium ja/nein`. Leichter zu evaluieren + kalibrieren; Multi-Class (P1/P2/P3) ist eine spätere Erweiterung.
- **Modell: XGBoost** (`model.json`-Export passt zur S3-Layout-Konvention, reifes SHAP-Zusammenspiel).
- **R-2 (Imbalance): Class-Weights** (`scale_pos_weight`) statt Over-/Undersampling — deterministisch, kein synthetisches Daten-Risiko.

## Risks & Open Questions

- **R-1:** FastF1-Cache wächst → fester Cache-Ordner `.fastf1-cache/` (gitignored), dokumentierte Saison-Spanne; Download einmalig, danach offline reproduzierbar.
- **R-3:** Leakage ist das Hauptrisiko — alle Features müssen **vor** dem Renn-Start bekannt sein. Tests erzwingen das (Feature-Pipeline kennt keine Renn-Ergebnis-Spalten außer dem Target).
- **R-4:** FastF1-Datenlücken (alte Saisons, fehlende Quali) → Zeilen mit fehlenden Pflicht-Features werden dokumentiert verworfen, nicht still imputiert.
- **Q-2:** Saison-Spanne (Vorschlag: Train ≤ 2023, Val 2024, Test 2025) — final im Plan, abhängig von FastF1-Verfügbarkeit.

## Dependencies

- **Phase 1 abgeschlossen** (✅): S3-Bucket existiert für den Modell-Upload; `@f1/shared` `S3_PATHS.modelArtifact`/`modelCard` definieren die Pfade (als Referenz, der Python-Code spiegelt das Layout).
- Python ≥ 3.12, FastF1, pandas, scikit-learn, xgboost, shap, boto3.
- Lokaler AWS-Zugang (Profil) nur für den finalen Artefakt-Upload (wie Phase-1-Deploy).

## Definition of Done

- Notebook in `ml/notebooks/` (reproduzierbar, Metriken prominent vs. Baseline).
- Modell-Artefakt + `model_card.md` in S3 unter `models/<semver>/`.
- Feature-Pipeline ist modular + getestet (Determinismus, kein Leakage).
- README erwähnt das Modell + Score.
- Spec-Status: `ML Model → done`, `git tag phase-3-done`.
