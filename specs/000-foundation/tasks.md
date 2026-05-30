# Tasks: Foundation

> **Plan:** [plan.md](./plan.md)
> **Status:** ready

Reihenfolge ist relevant — Abhängigkeiten markiert. Jeder Task = ein Commit (atomar).

## T1 — Monorepo-Grundgerüst

- **Output:** `package.json` (root), `pnpm-workspace.yaml`, `.npmrc`, `.gitignore`, `tsconfig.base.json`, leere Workspace-Ordner `apps/dashboard`, `apps/predictor`, `infra`, `packages/shared`, `ml`. Jeder Workspace hat eine minimale `package.json`.
- **Verify:** `pnpm install` läuft ohne Fehler. `pnpm -r exec node -v` listet alle Workspaces.
- **Notes:** `.npmrc` enthält `node-linker=hoisted` + `public-hoist-pattern[]=*aws-cdk*`.

## T2 — TypeScript-Basis

- **Output:** `tsconfig.base.json` mit `strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`. Jeder TS-Workspace erbt davon.
- **Verify:** `pnpm -r exec tsc --noEmit` läuft (leere Workspaces sind OK).

## T3 — ESLint + Prettier

- **Output:** Root-`eslint.config.mjs` (Flat Config), Prettier-Config. ESLint-Plugins für TS, React (für apps/\* vorbereitet), Import-Order.
- **Verify:** `pnpm exec eslint .` läuft ohne Fehler (auch wenn noch kaum Code da ist).
- **Constitution:** Artikel VI — Typsicherheit.

## T4 — `packages/shared` mit S3-Layout

- **Output:** `packages/shared/src/s3-layout.ts` (siehe Plan), `index.ts`, build-config.
- **Verify:** Importierbar aus `infra/` als `@f1/shared`.
- **Constitution:** Artikel III — geteilte Basis.

## T5 — AWS-Account + IAM-User + Budget (manuell)

- **Output:** IAM-User `f1-project-deployer` mit Policy aus dem Plan, Access-Keys lokal in `~/.aws/credentials` als Profile `f1-project`. AWS Budget mit Schwellen 50% (Warn) und 100% (Critical) auf `martin@michelberger.digital`.
- **Verify:** `AWS_PROFILE=f1-project aws sts get-caller-identity` zeigt den User. AWS-Konsole zeigt aktives Budget.
- **Notes:** Manueller Schritt (kein CDK), weil Bootstrap-Egg-Hen-Problem. **Constitution Artikel IV — Pflicht vor T8.**

## T6 — CDK-Skelett im `infra/`

- **Output:** `infra/package.json` mit `aws-cdk-lib@^2`, `constructs`, `aws-cdk@^2`. `infra/cdk.json`, `infra/bin/app.ts`, `infra/lib/data-layer-stack.ts` (leerer Stack).
- **Verify:** `pnpm -F infra cdk synth` erzeugt CloudFormation für leeren Stack.

## T7 — DataLayerStack (S3 + Lifecycle)

- **Output:** `data-layer-stack.ts` instanziiert `s3.Bucket` mit Encryption, Versioning, Block Public Access, Lifecycle-Rules aus dem Plan. Bucket-Name aus Account+Region abgeleitet. Tags `Project=f1`, `Phase=0`, `ManagedBy=cdk`.
- **Verify:** `cdk synth` zeigt Bucket-Ressource mit allen erwarteten Properties (Snapshot-Test optional).

## T8 — CDK Bootstrap + erster Deploy

- **Output:** `cdk bootstrap aws://<account>/eu-central-1` ausgeführt. `cdk deploy DataLayerStack` deployed.
- **Verify:** AWS-Konsole zeigt den Bucket. `aws s3 ls s3://<bucket>` läuft.
- **Notes:** Erst nach T5 (Budget muss live sein). **Constitution Artikel IV.**

## T9 — GitHub Actions CI

- **Output:** `.github/workflows/ci.yml` mit Jobs aus dem Plan: setup, lint-ts, cdk-synth, python-lint (skipped).
- **Verify:** Push auf einen Branch → CI grün.

## T10 — `.env.example` + Dokumentation

- **Output:** `.env.example` (siehe Plan), Abschnitt "Setup" in `README.md` mit Schritten 1–6 zum lokalen Start.
- **Verify:** Jemand Fremdes kann anhand README + .env.example lokal `cdk synth` ausführen.

## T11 — Architektur-Diagramm im README

- **Output:** ASCII-Diagramm (oder Mermaid) der Gesamt-Architektur in `README.md`, das alle 5 Phasen zeigt und markiert, was schon existiert vs. geplant ist.
- **Verify:** Recruiter-Test — Bild + 3 Sätze erklären das System.
- **Constitution:** Artikel XII.

## T12 — Phase-0-Abschluss-Commit + Tag

- **Output:** Alle Tasks committed, `git tag phase-0-done`.
- **Verify:** `README.md` Spec-Status-Tabelle aktualisiert (`Foundation` → `done`). CI grün.
