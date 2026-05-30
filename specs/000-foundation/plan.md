# Plan: Foundation

> **Spec:** [spec.md](./spec.md)
> **Status:** done

## Architektur

```
┌─────────────────────────────────────────────────────────┐
│                    F1-PROJECT (monorepo)                │
│                                                         │
│  apps/                                                  │
│    dashboard/         (Phase 2: Next.js + WebSocket)    │
│    predictor/         (Phase 4: Next.js + Bedrock UI)   │
│                                                         │
│  infra/               (Phase 0+: AWS CDK TS)            │
│    bin/app.ts                                           │
│    lib/data-layer-stack.ts    ← S3, DynamoDB            │
│    lib/pipeline-stack.ts      (Phase 1)                 │
│    lib/api-stack.ts           (Phase 2)                 │
│    lib/inference-stack.ts     (Phase 4)                 │
│                                                         │
│  packages/shared/     (TS types, Zod schemas, S3 paths) │
│    src/s3-layout.ts           ← single source of truth  │
│    src/openf1-schema.ts       (Phase 1)                 │
│    src/event-schema.ts        (Phase 1)                 │
│                                                         │
│  ml/                  (Phase 3: FastF1, XGBoost)        │
│                                                         │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  AWS Account  │
                    │  (eu-central-1)│
                    │               │
                    │  S3 Bucket    │ ← Phase 0
                    │  Budget Alarm │ ← Phase 0
                    │  (Pipeline-   │
                    │   Stacks ab   │
                    │   Phase 1)    │
                    └───────────────┘
```

## Komponenten

### Monorepo (pnpm workspaces)

- **Verantwortung:** Source-of-truth-Layout. Trennt App-Code, Infra, geteilte Typen, ML.
- **Setup:** `pnpm-workspace.yaml` listet `apps/*`, `infra`, `packages/*`. `package.json` hat `engines.node >= 20`, `engines.pnpm >= 9`.
- **Failure-Mode:** Hoisting-Probleme mit CDK → `.npmrc` mit `public-hoist-pattern[]=*aws-cdk*` und `node-linker=hoisted`.

### AWS-Account-Schutz (manuell + CDK)

- **Budget-Alarm:** `F1-Project` Budget mit 5 USD/Monat, Schwellen 50% (Warning Email) und 100% (Critical Email). Empfänger: `martin_schweiger@outlook.de`. Per CLI angelegt in Account `128663321407`. Zusätzlich existiert das account-weite `My Zero-Spend Budget` (1 USD Limit, Alarm bei jedem Cent Ausgaben) als First-Line-Defense.
- **IAM-User:** `Martin-dev` im Account `128663321407` wird wiederverwendet — Permissions: `PowerUserAccess` + `IAMFullAccess` + `AWSBillingReadOnlyAccess`. Pragmatischer Kompromiss für Solo-Lernprojekt (kein dedizierter `f1-project-deployer`-User).
- **AWS CLI:** Profil `private` zeigt auf den Account. `AWS_PROFILE=private` ist der Standard für lokale Operationen.
- **CDK-Bootstrap:** `cdk bootstrap aws://128663321407/eu-central-1` einmal vor dem ersten Deploy (T8).

### S3 Data Layer (CDK Stack `DataLayerStack`)

- **Bucket-Name:** `f1-data-<account-id>-<region>` (deterministisch, kollisionsfrei).
- **Region:** `eu-central-1`.
- **Encryption:** S3-managed (SSE-S3) — KMS overkill für Lernprojekt.
- **Versioning:** an (Schutz gegen versehentliches Überschreiben).
- **Lifecycle-Rules:**
  - `raw/sessions/`: nach 30 Tagen auf S3 Infrequent Access, nach 180 Tagen löschen (sonst läuft Storage über die Saison voll).
  - `models/`: keine Expiration (Versionierung zählt).
  - `_tmp/`: 1 Tag, dann weg.
- **Block Public Access:** komplett geblockt.
- **CORS:** vorerst nicht — Frontend liest nicht direkt, sondern über WebSocket/API.

### `packages/shared` — Single Source of Truth

- **`src/s3-layout.ts`** exportiert:
  ```ts
  export const S3_PATHS = {
    rawSession: (date: string, sessionId: string) => `raw/sessions/${date}/${sessionId}.jsonl`,
    modelArtifact: (version: string) => `models/${version}/model.json`,
    modelCard: (version: string) => `models/${version}/model_card.md`,
  } as const;
  ```
- Phase 1 (Pipeline) und Phase 3 (ML) **importieren** von hier — keine String-Literale verstreut.

### CI (GitHub Actions)

- Trigger: `push`, `pull_request`.
- Jobs:
  1. `setup`: Checkout, pnpm install (mit Cache).
  2. `lint-ts`: `tsc --noEmit` über alle TS-Workspaces; `eslint .`.
  3. `cdk-synth`: `pnpm -F infra cdk synth` (validiert IaC ohne Deploy).
  4. `python-lint` _(prepared, skipped solange `ml/` leer)_: `ruff check ml/`.

## Datenmodelle

In dieser Phase nur S3-Pfade (siehe oben). DynamoDB-Schema kommt in Phase 1, weil die Zugriffsmuster (Single-Table-Design hängt davon ab, was die Pipeline liest/schreibt) dort entstehen.

## Externe Verträge

Keine in Phase 0 (kein OpenF1, kein Bedrock).

## Security & IAM

- **Deployer-Identität:** `Martin-dev` im Account `128663321407` (Profil `private`). Permissions = `PowerUserAccess` + `IAMFullAccess` + `AWSBillingReadOnlyAccess`. **Bewusste Abweichung** von "least privilege" — pragmatischer Kompromiss für ein Solo-Lernprojekt. `PowerUserAccess` ist explizit kein Admin (kein IAM-Schreibrecht außer für sich selbst). Wenn das Projekt mal mit echtem Team läuft, wird ein dedizierter `f1-project-deployer`-User mit minimaler Policy nachgezogen.
- **Service-Permissions (Lambda, DDB, SQS, EventBridge, Bedrock)** werden ab Phase 1 pro Stack via CDK-Rollen vergeben — least privilege gilt für die **deployten Ressourcen**, auch wenn der Deployer breit ist.
- AWS-Credentials lokal in `~/.aws/credentials` unter dem Profilnamen `private`. Niemals im Repo.
- `.env.example` listet: `AWS_PROFILE=private`, `AWS_REGION=eu-central-1`, `CDK_DEFAULT_ACCOUNT=128663321407`, `CDK_DEFAULT_REGION=eu-central-1`.

## Observability

Phase 0 hat noch keine laufenden Services. Vorbereitet:

- CloudWatch Log Group Prefix `/f1/` (Convention) — Phase 1 nutzt das.
- Standard-CDK-Tags auf alle Ressourcen: `Project=f1`, `Phase=<n>`, `ManagedBy=cdk`.

## Kosten-Footprint

- **S3:** leer → ~0 €. Selbst mit 100 GB raw über die Saison: ca. 2,30 € / Monat in `eu-central-1`.
- **Budget-Alarm:** kostenlos (erste 2 sind frei).
- **IAM, CloudWatch Logs leer:** 0 €.
- **Erwartet Phase 0:** ≤ 0,50 € / Monat.

## Test-Strategie

- `cdk synth` in CI ist der Test (validiert Stack-Definition).
- Optional: `cdk-nag` als Best-Practices-Linter — nice to have, nicht Pflicht für Phase 0.
- Snapshot-Tests für CDK kommen ab Phase 1 (wenn echte Logic im Stack ist).

## Abweichungen von der Constitution

- **Artikel VII (Security by Default):** Deployer-User nutzt `PowerUserAccess` statt einer dedizierten Minimal-Policy. Pragmatischer Kompromiss für Solo-Lernprojekt. **Mitigation:** Service-Rollen für deployte Ressourcen sind weiterhin least privilege; Account hat zwei Budget-Alarme als Schadensbegrenzung.
