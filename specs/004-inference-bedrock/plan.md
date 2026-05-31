# Plan: Inference + Bedrock

> **Spec:** [spec.md](./spec.md)
> **Status:** ready — Entscheidungen (D2/D5/Feature-Quelle) mit Martin geklärt; Implementierung wartet auf das publishte Phase-3-Artefakt
> **Phase:** 004

Schließt Projekt 1 ab: das in Phase 3 trainierte, nach `models/<semver>/` publishte
XGBoost-Modell in Produktion bringen, pro Fahrer eine Podium-Wahrscheinlichkeit
berechnen und per Claude (Bedrock) in 3 Sätze natürlicher Sprache übersetzen —
sichtbar in einer zweiten Live-URL (`apps/predictor`).

Architektur-Leitsatz (Spec AC-5): **Bedrock erklärt, sagt nicht vorher.** Die
Wahrscheinlichkeiten kommen ausschließlich aus dem Modell; das LLM bekommt die
SHAP-Top-Features als strukturierten Input und formuliert nur.

## Architektur

```
EventBridge (T-60min vor Race, via Schedule-Sync-Muster aus Phase 1)
        │
        ▼
┌──────────────────────┐   models/<semver>/model.json   ┌──────────────┐
│  Inference Lambda     │◀───────────────────────────────│  S3 (Ph. 3)  │
│  (Python, Docker img) │                                 └──────────────┘
│  1. Features bauen     │   FastF1 quali+history → f1pred.features
│  2. XGBoost predict    │   → P(podium) je Fahrer
│  3. SHAP per-driver     │   → Top-N Beiträge je Fahrer
└─────────┬─────────────┘
          │ PutItem (prediction#<N>)
          ▼
┌──────────────────────┐        InvokeModel (Claude Haiku)     ┌──────────────┐
│  DynamoDB             │◀──────────────────────────────────────│   Bedrock     │
│  F1Predictions        │   explanation#<N> (gecacht, AC-3)      │  (Claude)     │
│  (race#<date>#<round>)│                                        └──────────────┘
└─────────┬─────────────┘
          │ Query race#<date>#<round>
          ▼
┌──────────────────────┐
│  apps/predictor       │  Balken (P sortiert, US-1) + ausklappbare
│  Next.js, Vercel      │  Bedrock-Begründung je Fahrer (US-2)
└──────────────────────┘
```

Zwei Schichten, beide neu: ein **Inference-Stack** (`infra/lib/inference-stack.ts`)
mit der Inference-Lambda + der `F1Predictions`-Tabelle + EventBridge-Trigger +
Alarmen, und das **Predictor-Frontend** (`apps/predictor`, separat auf Vercel
deployed wie das Dashboard in Phase 2).

## Komponenten

### 1. Inference Lambda (`infra/lambda/inference/`, Python via Docker-Image)

- **Verantwortung:** Einmal pro Rennen (Trigger T-60min) für jeden gemeldeten
  Fahrer die 6 Pre-Race-Features bauen, das Modell laden, `P(podium)` + SHAP-Top-N
  berechnen, als `prediction#<N>`-Items nach `F1Predictions` schreiben.
- **In:** EventBridge-Event `{ race_date, round, model_version }`. Modell aus
  `S3_PATHS.modelArtifact(version)`. Feature-Quellen: das gerade beendete Qualifying
  (`grid_position`, `quali_gap_to_pole_s`) + rollierende Historie
  (`driver_form`, `constructor_form`, `track_history`) + Wetter (`is_wet`).
- **Out:** N × `prediction#<N>`-Item (proba, shap_top, model_version, predicted_at).
- **Reuse (Constitution III):** importiert `f1pred.features.build_features`,
  `f1pred.schema.{FEATURE_NAMES, PodiumFeatures}` und `f1pred.layout.model_artifact_key`
  aus dem Phase-3-`ml/`-Paket — **kein** Nachbau der Feature-Logik. Identische
  Feature-Reihenfolge wie im Training, sonst stille Fehlvorhersage.
- **Packaging (D1):** `lambda.DockerImageFunction` mit `public.ecr.aws/lambda/python:3.12`
  - `xgboost`/`shap`/`pydantic`/`boto3` + das `f1pred`-Paket. Erster Python-Lambda
    im Repo (bisher nur NodejsFunction) — Zip scheitert an den xgboost/shap-Wheels.
- **Failure-Mode:** Modell fehlt / Schema-Drift (Feature-Anzahl ≠ 6) → laut Fehler
  (Constitution VI), kein Default-Wert. Einzelner Fahrer ohne Quali-Daten → der
  Fahrer wird übersprungen + geloggt (R-4-Muster aus Phase 3), Rest läuft.

### 2. Bedrock-Erklärung (in der Inference-Lambda, nach dem Predict)

- **Verantwortung:** Pro Fahrer die SHAP-Top-N-Features in einen strukturierten
  Prompt gießen (Template aus `@f1/shared/bedrock-prompts`), Claude aufrufen,
  Antwort (max. 3 Sätze, AC-2) als `explanation#<N>` neben der Prediction cachen.
- **Modell (Spec Q-1):** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — günstig,
  reicht für 3 Sätze.
- **Caching (AC-3, Constitution IV):** Erklärung wird nur erzeugt, wenn für die
  `(race, driver, model_version)`-Kombination noch keine existiert. Ein zweiter
  Page-Load liest nur DDB → 0 Bedrock-Kosten.
- **Failure-Mode:** Bedrock-Timeout/Throttle → Prediction wird trotzdem gespeichert,
  `explanation`-Feld bleibt leer, Frontend zeigt „Begründung folgt"; Retry beim
  nächsten Trigger. Bedrock-Fehler dürfen die Wahrscheinlichkeit nie blockieren.

### 3. Predictor-Frontend (`apps/predictor`, Next.js, Vercel)

- **Verantwortung:** Fahrer nach `P(podium)` absteigend als Balken (US-1), Klick
  → ausklappbare Bedrock-Begründung (US-2). Zeigt `model_version` + Cache-Status.
- **In/Out:** Liest Predictions für das nächste/laufende Rennen. Zugriff über eine
  schmale Read-API (Lambda/Route, `Query race#<date>#<round>`) — **kein** direkter
  DDB- oder Bedrock-Zugriff aus dem Client (Constitution VII).
- **Failure-Mode:** Noch keine Predictions (vor T-60min) → Empty-State „Vorhersage
  wird ~1h vor dem Rennen berechnet".

## Datenmodelle

- **`PodiumFeatures`** (pydantic, aus `ml/src/f1pred/schema.py`) — die 6 Pre-Race-
  Features in fester Reihenfolge: `grid_position`, `quali_gap_to_pole_s`,
  `driver_form`, `constructor_form`, `track_history`, `is_wet`. Inference validiert
  jede aggregierte Feature-Zeile damit, bevor sie ins Modell geht.
- **`F1Predictions`-Tabelle** (neu, on-demand, Streams aus für jetzt):
  - `PK = race#<date>#<round>`, `SK = prediction#<driverNumber>` (0-gepaddet)
  - Attribute: `podium_probability` (float), `shap_top` (Liste `{feature, contribution}`),
    `model_version`, `predicted_at`, `driver_number`, `driver_code`
  - `SK = explanation#<driverNumber>`: `{ bedrock_text, model_id, cached_at }` (AC-3)
- **Prompt-Templates** in `packages/shared/src/bedrock-prompts.ts`, versioniert
  (Spec R-2) — System-Prompt + Few-Shot + die strukturierte Feature-Einsetzung.
- **Zod** in `packages/shared/src/prediction-schema.ts`: `PredictionItemSchema`,
  `ExplanationItemSchema`, `PredictionApiResponseSchema` — Single Source für
  Inference-Output, Read-API und Frontend (Constitution III + VI).

## Externe Verträge

- **Phase-3-Artefakt:** `S3_PATHS.modelArtifact(version)` = `models/<semver>/model.json`
  (XGBoost native JSON, via `booster.load_model`), `S3_PATHS.modelCard(version)`.
- **Bedrock:** `bedrock-runtime:InvokeModel`, Claude Haiku 4.5, Region `eu-central-1`.
- **F1Live (Phase 1):** read-only, falls Live-Quali-Daten von dort statt FastF1
  gezogen werden (Alternative, siehe offene Entscheidung).
- **Shared-Keys:** `bucketName(account, region)` + `S3_PATHS.*` aus `@f1/shared/s3-layout`;
  neue Prediction-Keys als `predictionSK`/`explanationSK` in `@f1/shared/ddb-keys`
  ergänzen (nie hand-gebaut, Constitution III).

## Security & IAM

- **Inference-Lambda (least privilege, Constitution VII):** `s3:GetObject` nur auf
  `models/*`; `dynamodb:PutItem`/`Query` nur auf `F1Predictions`;
  `bedrock-runtime:InvokeModel` nur auf die eine Claude-Modell-ARN.
- **Read-API-Lambda:** nur `dynamodb:Query` auf `F1Predictions`.
- **Secrets:** Bedrock braucht keinen API-Key (IAM-basiert). Falls ein Read-API-Token
  o.ä. nötig wird → SSM SecureString wie das WS-Token in Phase 2, nie im Bundle.
- **Frontend:** kein AWS-Credential im Client; geht ausschließlich über die Read-API.

## Observability (Constitution VIII)

- Strukturierte JSON-Logs (model_version, race, n_drivers, bedrock_cache_hits).
- Custom Metrics: `InferenceDrivers`, `BedrockCalls`, `BedrockCacheHits`, `BedrockErrors`.
- **Alarme vor „done":** Inference-Lambda Errors ≥ 1 / Run; Bedrock-Error-Rate hoch;
  „keine Prediction trotz EventBridge-Trigger" (Silence-Alarm) → SNS `f1-alerts`
  (dasselbe Topic wie Phase 1/2).

## Kosten-Footprint (Constitution IV)

| Posten               | Annahme                                          |         €/Jahr |
| -------------------- | ------------------------------------------------ | -------------: |
| Inference-Lambda     | 1× pro Rennen (~24/Jahr) × ~30 s, Docker-ARM64   |         ~ 0.20 |
| Bedrock Claude Haiku | 24 Rennen × 20 Fahrer × ~300 Tokens, **gecacht** |    ~ 0.30–0.60 |
| DDB F1Predictions    | on-demand, ~960 Writes/Jahr + Reads              |         ~ 0.02 |
| ECR (Image-Storage)  | 1 Image, < 1 GB                                  |         ~ 0.10 |
| **Total**            |                                                  | **≈ 1 €/Jahr** |

Steady State: Caching (AC-3) heißt, ein erneuter Page-Load kostet 0. Bedrock läuft
nur einmal pro `(race, model_version)`.

## Test-Strategie (Constitution X)

- **Unit (Python, in `ml/`):** Feature-Aggregation gegen synthetische Quali/History
  → `PodiumFeatures`; SHAP-Extraktion gegen einen Mini-`xgboost.Booster`; Prediction
  → DDB-Item-Mapping. Kein Netz.
- **Unit (TS, `@f1/shared`):** `prediction-schema` Round-Trips; `bedrock-prompts`
  Prompt-Bau gegen feste Inputs (Snapshot).
- **Integration:** Inference-Handler gegen ein Test-`model.json` + `moto`-DDB +
  gemockten Bedrock-Client (DI-Muster wie die Lambdas in Phase 1/2).
- **E2E (Playwright, Smoke):** Predictor-Seite lädt, zeigt Fahrer nach P sortiert,
  Klick öffnet die Begründung.

## Entscheidungen (mit Martin geklärt)

- **D2 — Bedrock-Region:** **`eu-central-1`** — Claude Haiku ist für den Account dort
  freigeschaltet (Spec R-1 aufgelöst). Ein Stack, eine Region; kein Cross-Region-Call,
  Secrets/IAM bleiben in `eu-central-1`.
- **D5 — Inference-Trigger:** **Pre-Race per EventBridge** (T-60min), konsistent mit
  dem Schedule-Sync-Muster aus Phase 1. Erfüllt AC-1 (einmalige Berechnung) + AC-3
  (Caching); kein On-Demand bei Seitenaufruf.
- **Feature-Quelle:** **FastF1** für Quali (`grid_position`, `quali_gap_to_pole_s`) +
  rollierende Historie (`driver_form`, `constructor_form`, `track_history`) — identisch
  zum Training, damit keine Feature-Drift zwischen Train und Inference entsteht.

## Abweichungen von der Constitution

- **Neue Tabelle `F1Predictions` statt Wiederverwendung von `F1Live`** (Art. III
  bevorzugt Minimal-Duplizierung): bewusst, weil Predictions einen anderen
  Lebenszyklus haben (einmal pro Rennen statt 24h-TTL-Live-Cache) und Phase 5
  (Feedback-Loop) sie mit den Ist-Ergebnissen vergleichen muss — sie dürfen nicht
  nach 24 h verschwinden. Keys kommen weiterhin aus `@f1/shared/ddb-keys`.
- **Erster Python-/Docker-Lambda** (bisher nur NodejsFunction): nötig wegen
  xgboost/shap; das Muster (pure Handler + DI, `lambda_function`/`lambda_handler`
  als Adapter) bleibt analog zu Phase 1/2.
- **Pure Handler im `f1pred`-Paket statt unter `infra/lambda/inference/`** (Plan §1):
  Die CI testet Python nur unter `ml/` (`pytest ml/`, `ruff check ml/`, `mypy ml/src`) —
  ein Handler unter `infra/` würde nicht in CI laufen und die Verify-Anforderung
  („pytest treibt den Handler") verfehlen. `handle_inference` + der Bedrock-Prompt-
  Mirror (`f1pred/bedrock_prompt.py`, byte-genau zu `@f1/shared/bedrock-prompts.ts`)
  liegen daher in `f1pred` (das per Dockerfile ohnehin ins Image installiert wird);
  der dünne boto3/FastF1-Adapter unter `infra/lambda/inference/` (T7) importiert ihn.
