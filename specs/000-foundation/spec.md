# Spec: Foundation

> **Phase:** 000
> **Status:** spec-ready
> **Owner:** Martin
> **Constitution:** alle Artikel aktiv. Diese Phase begründet I (Spec-First), III (Geteilte Basis), IV (Kostenkontrolle) und XII (README).

## Problem / Motivation

Beide Apps (Dashboard, Predictor) und alle weiteren Phasen brauchen dieselbe Grundlage: ein Monorepo, ein AWS-Account mit Schutzplanken, ein IaC-Setup, ein gemeinsames S3-Layout und eine Architektur-Doku. Wenn das nicht **einmal** sauber gemacht wird, doppeln sich Entscheidungen in Phase 1 und 3 — und werden inkonsistent.

Diese Phase liefert kein Feature, aber sie verhindert, dass die nächsten vier Phasen sich gegenseitig blockieren.

## User Stories

- **US-1:** Als Developer möchte ich `pnpm install && pnpm build` lokal grün laufen sehen, damit ich sofort produktiv bin.
- **US-2:** Als Operator möchte ich eine Cost-Bremse, die mich warnt, **bevor** ein Tippfehler im Lambda-Polling 50 € kostet.
- **US-3:** Als Reviewer möchte ich im README ein Architektur-Diagramm finden, das mir in 2 Minuten den ganzen Scope zeigt.
- **US-4:** Als Phase-1-Implementierung möchte ich auf einen S3-Bucket mit dokumentiertem Pfad-Layout zugreifen können, ohne neu zu entscheiden, wo Dinge liegen.

## Acceptance Criteria

- **AC-1:** Das Repo enthält die Workspaces `apps/dashboard`, `apps/predictor`, `infra/`, `packages/shared`, `ml/`. Ein leerer `pnpm install` läuft fehlerfrei durch.
- **AC-2:** Es existiert ein AWS-Account mit Budget-Alarm (Schwellenwert ≤ 10 € / Monat), der an `martin@michelberger.digital` notifiziert.
- **AC-3:** Es existiert ein IAM-User für lokales Deployment mit minimalen Rechten (nicht `AdministratorAccess`), und die AWS CLI ist lokal so konfiguriert, dass `aws sts get-caller-identity` ihn zurückgibt.
- **AC-4:** Ein CDK-Stack ist definiert (`infra/`), der den S3-Bucket inkl. Lifecycle-Regeln (siehe Plan) deployen kann. `cdk synth` liefert valides CloudFormation.
- **AC-5:** Das S3-Pfad-Layout ist in `packages/shared` als Konstanten + Helper-Funktionen exportiert (Single Source of Truth — Phase 1 und 3 importieren von hier).
- **AC-6:** `README.md` enthält ein ASCII- oder Bild-Architekturdiagramm, das beide Systeme und die geteilte Pipeline zeigt.
- **AC-7:** Eine GitHub-Actions-CI ist eingerichtet, die bei jedem Push `tsc --noEmit`, `eslint`, `cdk synth` und (vorbereitet) Python-Lints laufen lässt.
- **AC-8:** Ein `.env.example` dokumentiert alle benötigten Variablen; echte `.env`-Dateien sind via `.gitignore` ausgeschlossen.

## Out of Scope

- Tatsächlicher Deployment des Buckets in AWS (wird in Phase 1 mit der Pipeline zusammen deployed — kein leerer Bucket "auf Vorrat").
- Frontend-Setup (kommt in Phase 2).
- Python ML-Toolchain (FastF1, XGBoost) — kommt in Phase 3, hier nur Verzeichnis + `requirements.txt`-Platzhalter.
- DynamoDB-Tabelle (kommt in Phase 1, weil dort das Zugriffsmuster entsteht).

## Risks & Open Questions

- **R-1:** AWS CDK v2 hat Breaking Changes ggü. v1 — fest auf v2 commiten, kein Mix.
- **R-2:** `pnpm` + AWS CDK haben in der Vergangenheit Probleme mit Hoisting gemacht. Mitigation: `.npmrc` mit `node-linker=hoisted` oder `public-hoist-pattern[]=*aws-cdk*`.
- **Q-1:** Region — `eu-central-1` (Frankfurt) ist Default für DE. Bedrock Claude ist dort verfügbar? **TBD vor Phase 4** — wenn nicht, eventuell `us-east-1` für Bedrock-spezifische Ressourcen.
- **Q-2:** Soll der Budget-Alarm bei 50%, 80%, 100% triggern, oder nur 100%? Empfehlung: 50% + 100%, damit Frühwarnung existiert.

## Dependencies

- AWS-Account vorhanden (Voraussetzung, nicht Liefergegenstand).
- GitHub-Repo angelegt + lokal verbunden.
- Node ≥ 20, pnpm ≥ 9, Python ≥ 3.12, AWS CLI v2 lokal installiert.

## Definition of Done

- Repo-Struktur committed, CI grün auf `main`.
- `cdk synth` läuft lokal fehlerfrei.
- AWS-Konsole zeigt Budget-Alarm aktiv.
- README ist publish-ready (Diagramm + Stack + Spec-Status).
- Ein Recruiter-Test: jemand Fremdes öffnet das Repo und versteht in 2 Minuten, was hier passieren soll.
