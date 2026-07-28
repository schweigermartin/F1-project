# Tasks: Kalibrierung & Aktualität (Phase 010)

> Spec: [`spec.md`](./spec.md) · Plan: [`plan.md`](./plan.md)
> Commit-Format: `<type>(phase-10/TX): <imperative>`

## Block A — Normalisierung auf drei Plätze

- [x] **T1** — `packages/shared/src/podium-normalize.ts` anlegen: `normalizePodiumProbabilities(probs, slots)` per Logit-Shift + Bisektion (Plan §2.2), plus `effectivePodiumProbability(driver)` als Fallback-Helper. Randfälle nach Plan §2.3.
- [x] **T2** — `packages/shared/__tests__/podium-normalize.test.ts`: Summe = slots (AC-1), Rangerhaltung (AC-2), Wertebereich (AC-3), alle Randfälle, Idempotenz, Extremeingaben (alle 0 / alle 1).
- [x] **T3** — Re-Export in `packages/shared/src/index.ts`.
- [x] **T4** — `prediction-schema.ts`: optionales `podium_probability_normalized` auf `PredictionWithExplanationSchema`, mit Kommentar, warum `PREDICTION_API_SCHEMA_VERSION` **nicht** steigt (Plan §2.5 / AC-5). Bestehenden Schema-Test um „parst mit und ohne Feld" ergänzen.
- [x] **T5** — `infra/lambda/predictions-api/handler.ts`: normierte Werte beim Serialisieren ergänzen (Rohwert unverändert lassen, AC-4).
- [x] **T6** — Read-API-Test: Antwort trägt normierte Werte, Summe = 3 (± 0,01), `podium_probability` unverändert.
- [x] **T7** — Frontend: `sortByPodium` über den Helper sortieren, `PodiumBoard` zeigt den normierten Wert; `predictions-api.test.ts` entsprechend erweitern.

## Block B — Grid-Baseline sichtbar (AC-7, AC-8)

- [x] **T8** — `top3Overlap` in `apps/predictor/src/lib/live-diff.ts` ergänzen (+ Tests in `live-diff.test.ts`), inkl. leerer/unvollständiger Eingaben.
- [x] **T9** — `BaselineComparison.tsx`: Modell „x von 3" vs. Grid „x von 3" + Stichprobenvorbehalt; rendert `null` ohne Endergebnis.
- [x] **T10** — In `app/page.tsx` einhängen — ausschließlich aus bereits geladenen Props, kein neuer Fetch (AC-8).

## Block C — Trainingsfenster offenlegen (AC-6)

- [x] **T11** — `MODEL_PROVENANCE` in `@f1/shared` (Plan §4) + Test für bekannte und unbekannte Version.
- [x] **T12** — `PodiumBoard` rendert Trainingsfenster + Herkunft der Formkurven sichtbar ohne Klick.

## Block D — History-Refresh (AC-9, AC-10)

- [x] **T13** — `ml/src/f1pred/history.py` mit `append_races` (Dedupe auf `(year, round, driver)`, neue Zeile gewinnt, stabile Sortierung).
- [x] **T14** — `ml/tests/test_history.py`: Dedupe, Idempotenz (AC-9), Sortierung, **Leakage-Invarianz** (AC-10 — History verlängern, Features der früheren Rennen bleiben identisch).
- [x] **T15** — `ml/scripts/refresh_history.py` als dünner CLI-Adapter über `data.fastf1_load_race` + `append_races`, mit `--dry-run`. **Kein CI-Pfad** (braucht FastF1 + Netz + AWS).

## Abschluss

- [x] **T16** — Model Card `0.2.0` um den Abschnitt „Was die Wahrscheinlichkeit bedeutet" ergänzen (Normierung, kein gelerntes Calibration-Fit) — Constitution IX.
- [x] **T17** — README: Phasen-Tabelle + kurzer Abschnitt zur Bedeutung der Wahrscheinlichkeiten (Constitution XII).
- [x] **T18** — Gate: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `cdk synth` grün; ml: `ruff`, `mypy`, `pytest` grün (AC-11).
- [x] **T19** — Deploy `F1-Inference` am 2026-07-28 (UPDATE_COMPLETE, 37 s; nur Lambda-Code, keine Infrastruktur-Änderung). Verifiziert an vier gespeicherten Rennen — Σ normiert = **3,000000** bei jedem, Rangfolge identisch, kein Fahrer ohne Feld:

  | Runde           | Σ roh | Σ normiert | Top-3 (roh → normiert)            |
  | --------------- | ----- | ---------- | --------------------------------- |
  | 8 (2026-06-28)  | 5,83  | 3,000000   | VER 91→60 · LEC 88→53 · NOR 87→52 |
  | 9 (2026-07-05)  | 5,27  | 3,000000   | LEC 90→69 · ANT 90→68 · RUS 82→51 |
  | 10 (2026-07-19) | 4,94  | 3,000000   | VER 93→78 · ANT 90→69 · NOR 79→49 |
  | 11 (2026-07-26) | 5,57  | 3,000000   | NOR 94→74 · ANT 86→54 · HAM 81→46 |

- [ ] **T20** _(manuell, nach Deploy)_ — realer `refresh_history`-Lauf für 2026 R1–R11, Ergebnis im Spec-Status dokumentieren.
