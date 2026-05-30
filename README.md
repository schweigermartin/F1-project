# F1 Portfolio Project

Zwei zusammenhängende Systeme, die eine gemeinsame Datenpipeline teilen:

1. **Live Telemetry Dashboard** — event-driven AWS-Pipeline, die OpenF1-Daten in Echtzeit ingestiert, persistiert und über WebSockets in ein React-Frontend pusht. Demonstriert Infra-Skills (Lambda, SQS, DynamoDB, S3, EventBridge, API Gateway, IaC).
2. **Race Outcome Predictor** — ML-Modell (XGBoost/LightGBM) auf historischen FastF1- und live archivierten Daten, mit Bedrock-basierter natürlichsprachlicher Begründung. Demonstriert ML-Skills (Feature Engineering, Training, Evaluation, Inference, LLM-Integration).
3. **Feedback Loop** — verbindet beide: Vorhersagen vs. tatsächliche Ergebnisse → Trefferquote → Re-Training. Macht aus zwei Projekten ein System.

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

| #   | Phase                                                      | Status     | Ergebnis                                                  |
| --- | ---------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| 0   | [Foundation](specs/000-foundation/spec.md)                 | spec-ready | Monorepo + AWS-Setup + CDK + S3-Layout                    |
| 1   | [Data Pipeline](specs/001-data-pipeline/spec.md)           | spec-ready | OpenF1 → SQS → Lambda → DynamoDB + S3                     |
| 2   | [Live Dashboard](specs/002-dashboard/spec.md)              | stub       | WebSocket-API + React-Frontend auf Vercel                 |
| 3   | [ML Model](specs/003-ml-model/spec.md)                     | stub       | XGBoost-Podium-Classifier + SHAP + S3-Artefakt            |
| 4   | [Inference + Bedrock](specs/004-inference-bedrock/spec.md) | stub       | Inference-Lambda + Bedrock-Erklärung + Predictor-Frontend |
| 5   | [Feedback Loop](specs/005-feedback-loop/spec.md)           | stub       | Hit-Rate-Tracking + optional Re-Training                  |

## Stack

- **Monorepo:** pnpm workspaces (`apps/dashboard`, `apps/predictor`, `infra/`, `packages/shared`, `ml/`)
- **Infra:** AWS CDK (TypeScript)
- **Compute:** Lambda (TS für Ingest, Python für ML-Inference)
- **Storage:** S3 (raw events + model artifacts), DynamoDB (live state + predictions)
- **Messaging:** SQS + DLQ, EventBridge (Polling-Trigger), DynamoDB Streams (WebSocket-Push)
- **Frontend:** Next.js + Recharts/visx, deployed auf Vercel
- **ML:** Python, FastF1, XGBoost/LightGBM, SHAP, Bedrock (Claude) für Explanation
- **CI:** GitHub Actions

## Reihenfolge

Phase 0 → 1 → 2 → 3 → 4 → 5. Phase 2 schließt Projekt 2 ab; Phase 4 schließt Projekt 1 ab. Wenn die Zeit ausgeht, gibt es nach Phase 2 schon eine vollständige Demo.
