# Spec: Quali- & Practice-Features (Modell 0.2.0)

> **Phase:** 006
> **Status:** draft — Spec zur Review, noch kein plan.md/tasks.md
> **Owner:** Martin
> **Constitution:** IX (versionierte Artefakte, reproduzierbare Läufe, kein Leakage), VI (Typsicherheit + Validierung an Grenzen), III (geteilter Feature-Vertrag, einmal gebaut), X (Tests für die Feature-Pipeline), IV (Kosten / FastF1-Rate-Limit), XII (README aktuell).

## Problem / Motivation

Der Podium-Klassifier (Modell `0.1.0`, Phase 3) nutzt von der Quali nur **zwei** abgeleitete Größen (`grid_position`, `quali_gap_to_pole_s`) und **die Trainingsfahrten (FP1–FP3) gar nicht**. Damit liegt das stärkste pre-race-Signal zum Teil brach: Quali-Pace und Practice-Pace sind die direktesten Indikatoren für die Renn-Performance eines Wochenendes. Ziel dieser Phase ist ein erweitertes, leakage-freies Feature-Set und ein neu trainiertes Artefakt `0.2.0`, das `0.1.0` messbar schlägt — bei erhaltener Reproduzierbarkeit und ohne Inference-Kostenexplosion.

## User Stories

- **US-1:** Als ML-Reviewer möchte ich nachvollziehen, dass das Modell jetzt **echtes Quali- und Practice-Pace-Signal** verwendet — dokumentiert, begründet und leakage-frei.
- **US-2:** Als Phase-4-Inference möchte ich `models/0.2.0/` (Modell + `history.csv` + Model-Card) genauso laden wie heute `0.1.0`, ohne dass sich der Lauf-Vertrag ändert.
- **US-3:** Als Betreiber möchte ich `0.1.0` als **Fallback** behalten, falls `0.2.0` schlechter abschneidet oder Daten fehlen.
- **US-4:** Als ML-Reviewer möchte ich im Eval sehen, dass `0.2.0` `0.1.0` auf demselben zeitlichen Test-Split **schlägt** (sonst kein Roll-out).

## Neue Features (zusätzlich zu den 6 bestehenden)

Alle **pre-race bekannt** (Practice + Quali sind vor dem Renn-Start abgeschlossen — siehe R-4 für Sprint-Wochenenden):

| Feature | Quelle | Definition |
| --- | --- | --- |
| `quali_segment_reached` | Quali | Ordinal 1/2/3 — höchstes erreichtes Segment (Q3 erreicht = 3). Robust gegen Strafen. |
| `quali_grid_delta` | Quali + Grid | `grid_position − quali_position` (≥ 0 = Strafe/Rückversetzung). Fängt Grid-Strafen ab. |
| `quali_teammate_gap_s` | Quali | Bestzeit-Rückstand zum Teamkollegen in Sekunden (+ = langsamer). Isoliert Fahrer- von Auto-Pace. |
| `practice_best_pace_gap_s` | FP2/FP3 | Schnellste Practice-Runde als Gap zur Session-Bestzeit (Quali-Sim-Proxy). |
| `practice_long_run_pace_s` | FP2/FP3 | Median der Stint-Runden (Renn-Sim) als Gap zum Feld-Median; NaN-Policy siehe R-3. |
| `practice_laps_count` | FP1–FP3 | Summe gefahrener Practice-Runden (Zuverlässigkeits-/Datenmengen-Proxy). |

Feature-Set wächst damit von 6 → **12**. `FEATURE_NAMES` (geteilter Vertrag in `f1pred/schema.py` + Pydantic `PodiumFeatures`) wird die einzige Quelle der Wahrheit für Namen, Reihenfolge und Ranges — auch für `0.2.0`.

## Acceptance Criteria

EARS-Stil, beobachtbar/prüfbar.

- **AC-1:** Die 6 neuen Features sind in `FEATURE_NAMES` + `PodiumFeatures` definiert (Typ, Range), in der Feature-Pipeline berechnet und in der Model-Card begründet.
- **AC-2:** Alle neuen Features sind **pre-race bekannt**; Tests erzwingen, dass die Pipeline keine Renn-Ergebnis-Spalten (außer Target) liest. Practice/Quali-Werte eines Rennens stammen ausschließlich aus dessen eigenen Practice/Quali-Sessions (kein `.shift`-Bedarf — die Sessions liegen zeitlich vor dem Rennen).
- **AC-3:** Das Modell wird als `models/0.2.0/{model.json,history.csv,model_card.md}` nach S3 publisht (Pfade aus `S3_PATHS`/`f1pred.layout`, nie handgebaut). `0.1.0` bleibt unangetastet.
- **AC-4:** Das Eval berichtet `0.2.0` **vs. `0.1.0`** auf demselben zeitlichen Test-Split (Accuracy, Log-Loss, ROC-AUC, Kalibrierung, Konfusionsmatrix). Roll-out-Gate: `0.2.0` schlägt `0.1.0` bei ROC-AUC **und** Log-Loss; sonst bleibt `0.1.0` aktiv und das Ergebnis wird dokumentiert.
- **AC-5:** Fehlende Practice-Daten werden nach dokumentierter Policy behandelt (R-3), nicht still imputiert; Drop-vs-Fill ist pro Feature begründet.
- **AC-6:** Der historische Practice/Quali-Backfill respektiert das FastF1/Ergast-500-calls/h-Limit (R-1): inkrementell, cache-gestützt, mit Backoff bei `RateLimitExceededError` — kein stilles Verwerfen von Runden.
- **AC-7:** Die Inference-λ lädt zur Laufzeit zusätzlich die Practice-Sessions des kommenden Rennens live; `history.csv` für `0.2.0` ist so vorberechnet, dass nur die Sessions des anstehenden Wochenendes live gezogen werden (gleiche Strategie wie `0.1.0`).
- **AC-8:** Fixierter Seed + gepinnte Datenversion → gleicher Score bei Re-Run (Constitution IX).
- **AC-9:** `0.2.0` ist erst „aktiv", wenn der reale Pre-Race-Auto-Run damit Vorhersagen + Bedrock-Begründungen erzeugt (analog Phase-4-Abschluss).

## Out of Scope

- Sprint-Format-Spezialmodell (nur Edge-Case-Behandlung, siehe R-4).
- Telemetrie-Features (Speed-Traps, Sektor-Mikrodaten) — datenintensiv, eigene spätere Phase.
- Re-Training-Loop / Feedback (bleibt Phase 5).
- Hyperparameter-Großsuche — bestehendes XGBoost-Set wird übernommen, nur bei Bedarf nachjustiert.
- Multi-Class (P1/P2/P3) — bleibt binär `podium ≤ 3`.

## Resolved Decisions

- **D-1 (Quali-Signal):** `quali_segment_reached`, `quali_grid_delta`, `quali_teammate_gap_s` zusätzlich zu den bestehenden zwei Quali-Features.
- **D-2 (Practice-Signal):** `practice_best_pace_gap_s`, `practice_long_run_pace_s`, `practice_laps_count`.
- **D-3 (Versionierung):** neue Minor-Version `0.2.0`; `0.1.0` bleibt als Fallback erhalten (kein `latest/`, Constitution IX).

## Risks & Open Questions

- **R-1 (Hauptrisiko, Kosten):** Der historische Practice-Backfill vervielfacht die FastF1-Session-Loads (bisher 2 Sessions/Rennen → bis zu 5 mit FP1–FP3). Über alle Trainings-Saisons rennt das frontal ins 500-calls/h-Limit. → inkrementeller, cache-gestützter Backfill mit Backoff; ggf. Saison-Spanne reduzieren. Im Plan zu quantifizieren (Anzahl Calls × Saisons).
- **R-2 (Verfügbarkeit alter Saisons):** Practice-Lap-Daten sind in FastF1 erst ab ~2018 verlässlich. → dokumentierte, ggf. engere Saison-Spanne als `0.1.0`; fehlende Sessions sauber behandeln (R-3), nicht still droppen.
- **R-3 (Missing-Policy):** Regen-FP / abgesagte Sessions / fehlende Long-Runs liefern NaN. Pro Feature entscheiden: `practice_laps_count` → 0; `practice_best_pace_gap_s`/`practice_long_run_pace_s` → neutraler Konstanten-Fill (analog `NEUTRAL_TRACK_HISTORY`, keine Datenabhängigkeit = kein Leakage) statt Zeilen-Drop, sonst dezimiert man Regen-Wochenenden.
- **R-4 (Sprint-Wochenenden):** Nur FP1, dann Sprint-Quali statt FP2/FP3 → Practice-Pace-Features dünn. Edge-Case explizit behandeln (Fill-Policy greift); im Plan festlegen, ob ein `is_sprint`-Flag nötig ist.
- **R-5 (Leakage):** Quali/Practice liegen vor dem Rennen → kein `.shift` nötig, aber Tests müssen erzwingen, dass keine Renn-Spalten einfließen und Practice-Werte nicht versehentlich aus späteren Sessions stammen.
- **R-6 (Inference-Latenz/Rate-Limit):** Live-Fetch zusätzlicher Practice-Sessions bei T-60min erhöht FastF1-Calls pro Lauf. → nur die nötigen Sessions laden, Bedrock-/Daten-Caching beibehalten.

## Dependencies

- **Phase 3 + 4 abgeschlossen** (✅): bestehende Feature-Pipeline, Trainings-Notebook, Inference-λ, `history.csv`-Mechanik und `S3_PATHS`/`f1pred.layout` werden erweitert, nicht neu gebaut.
- FastF1 (Practice-Lap-Daten), pandas, xgboost, shap, boto3; lokaler AWS-Zugang (Profil `private`) für Backfill + Artefakt-Upload.
- Bestehende `0.1.0`-Artefakte als Eval-Baseline.

## Definition of Done

- `FEATURE_NAMES`/`PodiumFeatures` auf 12 Features erweitert; Feature-Pipeline modular + getestet (Determinismus, kein Leakage, Missing-Policy).
- `models/0.2.0/{model.json,history.csv,model_card.md}` in S3; `0.1.0` erhalten.
- Eval zeigt `0.2.0` vs. `0.1.0` auf gleichem Test-Split; Roll-out-Gate erfüllt (oder dokumentierter Verzicht).
- Inference-λ lädt `0.2.0` inkl. Live-Practice-Fetch; realer Pre-Race-Lauf erzeugt Vorhersagen + Begründungen.
- README + Phasen-Tabelle aktualisiert (Constitution XII).
- Spec-Status: `Quali- & Practice-Features → done`, `git tag phase-6-done`.
