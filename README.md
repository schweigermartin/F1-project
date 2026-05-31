# F1 Portfolio Project

[![CI](https://github.com/schweigermartin/F1-project/actions/workflows/ci.yml/badge.svg)](https://github.com/schweigermartin/F1-project/actions/workflows/ci.yml)

Zwei zusammenhängende Systeme, die eine gemeinsame Datenpipeline teilen:

1. **Live Telemetry Dashboard** — event-driven AWS-Pipeline, die OpenF1-Daten in Echtzeit ingestiert, persistiert und über WebSockets in ein React-Frontend pusht. Demonstriert Infra-Skills (Lambda, SQS, DynamoDB, S3, EventBridge, API Gateway, IaC).
2. **Race Outcome Predictor** — ML-Modell (XGBoost/LightGBM) auf historischen FastF1- und live archivierten Daten, mit Bedrock-basierter natürlichsprachlicher Begründung. Demonstriert ML-Skills (Feature Engineering, Training, Evaluation, Inference, LLM-Integration).
3. **Feedback Loop** — verbindet beide: Vorhersagen vs. tatsächliche Ergebnisse → Trefferquote → Re-Training. Macht aus zwei Projekten ein System.

## Architektur

`✅` = deployed · `🛠️` = in Arbeit / Code da · `📋` = nur Spec, noch kein Code

```
                         ┌──────────────┐
                         │  OpenF1 API  │ ✅ (Phase 1, live)
                         └──────┬───────┘
                                │ poll (5s, nur während Sessions)
                                ▼
                       ┌─────────────────┐
                       │  Poller Lambda  │ ✅ F1-Poller
                       └────────┬────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  SQS + DLQ       │ ✅ F1-Events / F1-Events-DLQ
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐         ┌────────────────────┐
                       │ Consumer Lambda  │────────▶│ S3 (raw archive)   │ ✅ Bucket live
                       │ F1-Consumer      │ ✅      │ raw/sessions/...   │     in eu-central-1
                       └────────┬─────────┘         │ models/<semver>/   │
                                │                   └─────────┬──────────┘
                                ▼                             │ Archiver λ ✅
                       ┌──────────────────┐                   │ (15min cron)
                       │  DynamoDB        │ ✅ F1Live         │
                       │  (TTL 24h)       │                   │
                       │  + Streams       │                   │
                       └───┬─────────┬────┘                   │
                           │         │                        │
                           │         │ Stream                 │ training data
                           │         ▼                        ▼
                           │   ┌──────────────┐         ┌──────────────┐
                           │   │  WebSocket   │ ✅      │  Training    │ 🛠️ (Phase 3)
                           │   │  API Gateway │ (Ph. 2) │  (FastF1 +   │ Code da
                           │   │  +5 λ +auth  │ live    │   XGBoost)   │
                           │   └──────┬───────┘         │              │
                           │          │                 └──────┬───────┘
                           │          ▼                        │
                           │   ┌──────────────┐                ▼
                           │   │ apps/dashbd  │ ✅      ┌──────────────┐
                           │   │ Next.js+visx │ Vercel  │ model.json   │
                           │   └──────────────┘         │ in S3        │
                           │                            └──────┬───────┘
                           │ predictions + actuals             │
                           │ (Feedback Loop, Phase 5)          │
                           │                                   ▼
                           │                            ┌──────────────┐
                           └──────────────────────────▶ │  Inference   │ 📋 (Phase 4)
                                                        │  Lambda      │
                                                        │  + Bedrock   │
                                                        │  (Claude)    │
                                                        └──────┬───────┘
                                                               │
                                                               ▼
                                                        ┌──────────────┐
                                                        │ apps/pred.   │ 📋 (Phase 4)
                                                        │ Next.js,     │
                                                        │ Bars + LLM   │
                                                        │ Erklärungen  │
                                                        └──────────────┘

Scheduler (täglich 04:00 UTC):
- F1-ScheduleSync λ ✅ pollt OpenF1 /sessions, programmiert für jede kommende
  Session ein aws-scheduler Schedule mit Window [start-15min, end+30min]

Querschnitt (alle Phasen):
- IaC: AWS CDK v2 (TypeScript)              ✅ 3 Stacks (DataLayer + Pipeline + Realtime)
- Geteilte Typen: packages/shared (Zod)     ✅ S3-Pfade + 6 OpenF1-Schemas + DDB-Keys
- CI: GitHub Actions (lint+typecheck+test)  ✅ grün auf main
- Cost-Guards: AWS Budget 5 USD/Monat       ✅ aktiv (50%/100% Alarme)
- Observability: CloudWatch Dashboards      ✅ f1-pipeline + f1-realtime, 7 Alarme via SNS
```

## Spec-Driven Development

Dieses Projekt folgt SDD (spec-kit-inspiriert). Workflow:

```
Constitution → Spec → Plan → Tasks → Implement
```

- `.specify/constitution.md` — projektweite Prinzipien (gelten für alle Phasen)
- `specs/<NNN>-<name>/spec.md` — WAS und WARUM (User Stories, Acceptance Criteria, keine Technologie)
- `specs/<NNN>-<name>/plan.md` — WIE technisch (Architektur, Datenmodelle, Verträge, Komponenten)
- `specs/<NNN>-<name>/tasks.md` — KONKRETE Schritte (sequenziell, einzeln committbar)

Pro Phase erst `spec.md` schreiben/reviewen → dann `plan.md` ableiten → dann `tasks.md` → erst dann Code.

## Phasen

| #   | Phase                                                      | Status      | Ergebnis                                                                                  |
| --- | ---------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| 0   | [Foundation](specs/000-foundation/spec.md)                 | ✅ done     | Monorepo + AWS-Setup + CDK + S3-Layout (deployed in eu-central-1)                         |
| 1   | [Data Pipeline](specs/001-data-pipeline/spec.md)           | ✅ deployed | OpenF1 → SQS → Lambda → DynamoDB + S3 (live since 2026-05-30)                             |
| 2   | [Live Dashboard](specs/002-dashboard/spec.md)              | ✅ deployed | F1-Realtime-Stack (WebSocket-API, 5 λ, HMAC-Auth) + Next.js/visx-Frontend live auf Vercel |
| 3   | [ML Model](specs/003-ml-model/spec.md)                     | 🛠️ code da  | XGBoost-Podium-Classifier + SHAP + S3-Artefakt                                            |
| 4   | [Inference + Bedrock](specs/004-inference-bedrock/spec.md) | stub        | Inference-Lambda + Bedrock-Erklärung + Predictor-Frontend                                 |
| 5   | [Feedback Loop](specs/005-feedback-loop/spec.md)           | stub        | Hit-Rate-Tracking + optional Re-Training                                                  |

## Stack

- **Monorepo:** pnpm workspaces (`apps/dashboard`, `apps/predictor`, `infra/`, `packages/shared`, `ml/`)
- **Infra:** AWS CDK (TypeScript)
- **Compute:** Lambda (TS für Ingest, Python für ML-Inference)
- **Storage:** S3 (raw events + model artifacts), DynamoDB (live state + predictions)
- **Messaging:** SQS + DLQ, EventBridge (Polling-Trigger), DynamoDB Streams (WebSocket-Push)
- **Frontend:** Next.js (App Router) + visx + Zustand, deployed auf Vercel
- **ML:** Python, FastF1, XGBoost/LightGBM, SHAP, Bedrock (Claude) für Explanation
- **CI:** GitHub Actions

## Reihenfolge

Phase 0 → 1 → 2 → 3 → 4 → 5. Phase 2 schließt Projekt 2 ab; Phase 4 schließt Projekt 1 ab. Wenn die Zeit ausgeht, gibt es nach Phase 2 schon eine vollständige Demo.

## Setup (lokal)

Voraussetzungen: Node ≥ 20, pnpm ≥ 9, Python ≥ 3.12, AWS CLI v2, ein AWS-Account mit IAM-User der mindestens `PowerUserAccess` hat.

```bash
# 1. Klonen und Dependencies
git clone git@github.com:schweigermartin/F1-project.git
cd F1-project
pnpm install

# 2. Eigene Env-Variablen anlegen
cp .env.example .env
# .env editieren: AWS_PROFILE auf deinen lokalen Profilnamen,
# CDK_DEFAULT_ACCOUNT auf deine Account-ID.

# 3. AWS-Profil konfigurieren (einmalig)
aws configure --profile <dein-profil>
# Verify:
AWS_PROFILE=<dein-profil> aws sts get-caller-identity

# 4. Lokale Validierung — alle drei sollten grün sein
pnpm lint
pnpm typecheck
pnpm test
AWS_PROFILE=<dein-profil> pnpm -F @f1/infra cdk synth

# 5. CDK Bootstrap (einmalig pro Account/Region)
AWS_PROFILE=<dein-profil> pnpm -F @f1/infra cdk bootstrap aws://<account>/<region>

# 6. Deploy (Pipeline + Realtime)
# F1-Realtime liest ein HMAC-Secret aus SSM — einmalig out-of-band anlegen:
SECRET=$(openssl rand -hex 32)
AWS_PROFILE=<dein-profil> aws ssm put-parameter --name /f1/ws-token-secret \
  --type SecureString --value "$SECRET" --region <region>
# danach deployen (allowedOrigins in infra/bin/app.ts auf deine Vercel-Domain setzen):
AWS_PROFILE=<dein-profil> pnpm -F @f1/infra cdk deploy F1-DataLayer F1-Pipeline F1-Realtime
```

Nach Schritt 6 existieren in deinem Account:

- S3-Bucket `f1-data-<account>-<region>`
- DDB Tables `F1Live` (Streams) + `F1Connections` (TTL 2h)
- SQS `F1-Events` + DLQ
- API Gateway WebSocket `F1-Realtime` (Stage `live`)
- 10 Lambdas (4 Pipeline: Poller/Consumer/Archiver/Schedule-Sync + 6 WS: Connect/Disconnect/Authorizer/Subscribe/Fanout/Replay)
- CloudWatch Dashboards `f1-pipeline` + `f1-realtime`, 7 Alarme, SNS-Topic `f1-alerts`

Das Frontend (`apps/dashboard`) wird separat auf Vercel deployed (Root Directory `apps/dashboard`, Env-Vars `NEXT_PUBLIC_WS_URL` = WebSocketUrl-Output + `WS_TOKEN_SECRET` = dasselbe SSM-Secret).

### Konsolen-Links (für Martins Account `128663321407`)

- [CloudFormation-Stacks (eu-central-1)](https://eu-central-1.console.aws.amazon.com/cloudformation/home?region=eu-central-1#/stacks?filteringStatus=active)
- [S3-Bucket](https://eu-central-1.console.aws.amazon.com/s3/buckets/f1-data-128663321407-eu-central-1)
- [DynamoDB `F1Live`](https://eu-central-1.console.aws.amazon.com/dynamodbv2/home?region=eu-central-1#table?name=F1Live)
- [SQS `F1-Events`](https://eu-central-1.console.aws.amazon.com/sqs/v3/home?region=eu-central-1#/queues)
- [Lambdas](https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions?fo=and&o0=%3A&v0=F1-)
- [CloudWatch Dashboard `f1-pipeline`](https://eu-central-1.console.aws.amazon.com/cloudwatch/home?region=eu-central-1#dashboards/dashboard/f1-pipeline)
- [Budgets](https://us-east-1.console.aws.amazon.com/billing/home#/budgets)
