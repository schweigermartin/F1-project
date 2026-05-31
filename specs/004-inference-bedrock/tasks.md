# Tasks: Inference + Bedrock

> **Plan:** [plan.md](./plan.md)
> **Status:** draft

Reihenfolge bewusst: geteilte Verträge zuerst → pure Inference-Logik (offline +
in CI testbar) → Infra (Docker-Lambda, Tabelle, Trigger, Alarme) → Read-API →
Frontend → (Martin) Deploy + realer Lauf + Abschluss. Alles ohne Netz/Creds läuft
in CI; Bedrock-Calls, Deploy und der reale Pre-Race-Lauf führt Martin aus (markiert).

## Konventionen

- `[ ]` offen, `[~]` in Arbeit, `[x]` erledigt. Jeder Task = ein Commit
  (`feat(phase-4/TX): …`), Spec-Änderungen separat.
- Jeder Task hat **Output** + **Verify**. TS: `tsc` + `eslint` + `vitest` grün,
  Zod für externe Daten. Python: Type-Hints, `ruff` + `mypy` + `pytest` grün,
  `logging` statt `print`, strukturierte JSON-Logs.
- Tasks ohne Netz/Creds laufen in CI; Bedrock/Deploy/realer Lauf = **(Martin)**.
- Vor jedem Lambda-Deploy: Budget-Alarm existiert; jeder Lambda hat einen
  Failure/Silence-Alarm bevor er „done" ist (Constitution IV/VIII).

## Aufgaben

### T1 — Geteilte Prediction-Schemas (`packages/shared/src/prediction-schema.ts`)

- **Output:** Zod `PredictionItemSchema` (driver_number, driver_code,
  podium_probability 0–1, shap_top: Liste `{feature, contribution}`, model_version,
  predicted_at), `ExplanationItemSchema` (bedrock_text, model_id, cached_at),
  `PredictionApiResponseSchema`. Re-Export aus `index.ts`. Single Source für
  Inference-Output, Read-API, Frontend (Constitution III/VI).
- **Verify:** `pnpm -F @f1/shared test` grün; Round-Trip-Tests (parse/serialize);
  `pnpm typecheck` + `pnpm lint` grün.

### T2 — Prediction-DDB-Keys (`packages/shared/src/ddb-keys.ts`)

- **Output:** `racePK(date, round)` → `race#<date>#<round>`, `predictionSK(driverNumber)`
  → `prediction#<0-padded>`, `explanationSK(driverNumber)` → `explanation#<0-padded>`.
  Konsistent mit den bestehenden Helpern (Padding wie `lapSK`/`stintSK`).
- **Verify:** Unit-Tests für die Key-Shapes + Sortierbarkeit; `@f1/shared` grün.

### T3 — Bedrock-Prompts (`packages/shared/src/bedrock-prompts.ts`)

- **Output:** Versionierte Prompt-Templates (Spec R-2): System-Prompt
  („du erklärst, sagst nicht vorher" — AC-5), Funktion `buildExplanationPrompt(driver,
  probability, shapTop)` → strukturierter User-Prompt, max. 3 Sätze gefordert (AC-2).
  Prompt-Version als Konstante exportiert.
- **Verify:** Snapshot-Tests gegen feste Inputs; keine PII/Secrets im Template.

### T4 — Inference-Kern (`ml/src/f1pred/inference.py`)

- **Output:** `predict_podium(model, features_df) -> list[Prediction]` (proba +
  SHAP-Top-N je Fahrer), wiederverwendet `f1pred.features.build_features`,
  `f1pred.schema.{FEATURE_NAMES, PodiumFeatures}`, `f1pred.explain` (SHAP).
  Feature-Reihenfolge == Training, Schema-Drift (≠ 6 Features) → laut Fehler.
- **Verify:** `pytest` mit synthetischem Mini-`xgboost.Booster` + synthetischen
  Quali/History-Daten; `ruff` + `mypy` grün. Kein Netz.

### T5 — Feature-Aggregation für die Live-Vorhersage (`ml/src/f1pred/inference.py`)

- **Output:** `build_race_features(race_date, round, *, load_quali, rounds_history)
  -> pd.DataFrame` — baut die 6 Pre-Race-Features für ein kommendes Rennen aus
  beendetem Quali + rollierender Historie (injizierbare Loader wie `data.py` in
  Phase 3, damit offline testbar). Fahrer ohne Quali → übersprungen + geloggt (R-4).
- **Verify:** `pytest` gegen injizierte Fake-Loader (kein FastF1/Netz); deckt
  „Fahrer ohne Quali" + leeres Feld ab.

### T6 — Inference-Lambda-Handler (`infra/lambda/inference/handler.py`)

- **Output:** pure `handle_inference(event, deps)` (DI: `load_model`, `load_features`,
  `put_prediction`, `invoke_bedrock`, `get_cached_explanation`, `now`, `emit_metric`,
  `logger`). Flow: Features → predict → `prediction#<N>` schreiben → falls keine
  gecachte Erklärung: Bedrock-Prompt → `explanation#<N>` cachen (AC-3). Bedrock-Fehler
  blockiert die Prediction nie.
- **Verify:** `pytest` treibt den Handler mit Fakes (Test-`model.json`, In-Memory-DDB,
  Mock-Bedrock); deckt Cache-Hit (kein Bedrock-Call), Cache-Miss, Bedrock-Fehler ab.

### T7 — Inference-Lambda-Adapter + Dockerfile (`infra/lambda/inference/`)

- **Output:** `lambda_function.py` (`lambda_handler` verdrahtet echte Clients:
  boto3 S3/DDB/bedrock-runtime), `Dockerfile` (`public.ecr.aws/lambda/python:3.12`,
  ARM64, installiert `f1pred` + xgboost/shap/pydantic). Strukturierte JSON-Logs.
- **Verify:** `docker build` lokal erfolgreich; Image < ~1 GB; Smoke-Invoke gegen
  ein Test-Event mit gemocktem Bedrock (lokal, kein Deploy).

### T8 — Inference-Stack (`infra/lib/inference-stack.ts`)

- **Output:** `InferenceStack` (Props: `dataBucket`, `alertTopic`, ggf. `liveTable`):
  `F1Predictions`-Tabelle (on-demand, kein 24h-TTL), `DockerImageFunction` für
  Inference, EventBridge-Regel (T-60min Pre-Race, Schedule-Sync-Muster), IAM
  least-privilege (S3 `models/*`, DDB `F1Predictions`, `bedrock:InvokeModel` auf die
  Modell-ARN). In `bin/app.ts` registriert + getaggt.
- **Verify:** `pnpm -F @f1/infra test` (CDK-Assertions: Tabelle, Lambda, Regel,
  IAM-Scope); `AWS_PROFILE=… cdk synth` grün.

### T9 — Alarme + Dashboard-Widget (`infra/lib/inference-stack.ts`)

- **Output:** CloudWatch-Alarme: Inference-Errors ≥ 1/Run, Bedrock-Error-Rate,
  Silence-Alarm („Trigger, aber keine Prediction") → SNS `f1-alerts`. `f1-inference`-
  Dashboard mit den Custom Metrics (`InferenceDrivers`, `BedrockCalls`,
  `BedrockCacheHits`, `BedrockErrors`).
- **Verify:** CDK-Test prüft, dass jeder Lambda einen Alarm hat (Constitution VIII);
  `cdk synth` grün.

### T10 — Read-API (`infra/lambda/predictions-api/` + Stack)

- **Output:** schmale Lambda (`Query race#<date>#<round>`) → `PredictionApiResponseSchema`,
  hinter Function-URL oder API-GW. CORS nur erlaubte Origins (Predictor-Vercel-Domain
  + localhost), kein `*` (Constitution VII). Kein direkter DDB/Bedrock-Zugriff aus dem Client.
- **Verify:** Handler-Unit-Test (moto-DDB); CDK-Test für CORS/IAM; `cdk synth` grün.

### T11 — Predictor-Frontend (`apps/predictor`)

- **Output:** Next.js-Seite: Fahrer nach `P(podium)` absteigend als Balken (US-1),
  Klick → ausklappbare Bedrock-Begründung (US-2), zeigt `model_version` + Cache-Badge.
  Empty-State vor T-60min. Liest die Read-API, Daten via Zod validiert.
- **Verify:** `pnpm -F @f1/predictor build` + `lint` + `typecheck` grün;
  Component-Test (sortierte Balken, Klick öffnet Begründung).

### T12 — E2E-Smoke (`apps/predictor`, Playwright)

- **Output:** Smoke-Test: Seite lädt, Fahrerliste sichtbar + nach P sortiert, Klick
  öffnet Begründung. Gegen gemockte Read-API-Response.
- **Verify:** Playwright grün in CI (oder lokal dokumentiert, falls CI ohne Browser).

### T13 — (Martin) Bedrock-Access + Deploy

- **Auszuführen (Konsole + Creds):** Bedrock-Model-Access für Claude Haiku in
  `eu-central-1` aktivieren (bestätigt verfügbar); `cdk deploy F1-Inference` (+ Read-API);
  Predictor auf Vercel deployen (Root `apps/predictor`, Read-API-URL als Env).
- **Verify:** Stacks `CREATE_COMPLETE`; Predictor-URL erreichbar; ein Test-Event
  erzeugt Predictions + (gecachte) Erklärungen in `F1Predictions`.

### T14 — (Martin) Realer Pre-Race-Lauf + Abschluss

- **Auszuführen:** vor mindestens einem realen Rennen Inference triggern → Predictions
  + Bedrock-Erklärungen generieren; Stichprobe der Bedrock-Outputs qualitativ prüfen
  (DoD); Caching verifizieren (zweiter Load = 0 Bedrock-Calls).
- **Verify:** Predictor zeigt Live-Vorhersagen vor dem Rennen; README + Architektur-
  Diagramm auf ✅ aktualisiert; `spec.md`/`plan.md`-Status → `done`; Tag `phase-4-done`.
