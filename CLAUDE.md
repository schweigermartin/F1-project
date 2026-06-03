# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

F1 portfolio monorepo with two systems sharing one AWS data pipeline:

1. **Live Telemetry Dashboard** — event-driven AWS pipeline ingesting OpenF1 data → DynamoDB/S3 → (future) WebSocket → React.
2. **Race Outcome Predictor** — XGBoost model on historical + archived data, with Bedrock (Claude) natural-language explanations.
3. **Feedback Loop** — predictions vs. actuals → hit-rate → re-training.

Built in phases (0–5). Phases 0–4 are done and deployed to AWS `eu-central-1` (both Next.js frontends live on Vercel); phase 5 (Feedback Loop) is a spec-only stub. See `README.md` for the architecture diagram and phase status table.

## Spec-Driven Development (read this before writing code)

This project follows SDD and the rule is enforced by `.specify/constitution.md` Article I: **no code without `spec.md` → `plan.md` → `tasks.md`, in that order.** If asked to build something mid-stream that lacks specs, write the spec back first.

- `.specify/constitution.md` — 12 project-wide principles. Treat as binding; cite article numbers in code comments as the existing code does (e.g. "Constitution III").
- `specs/<NNN>-<name>/spec.md` — WHAT/WHY (user stories, acceptance criteria, no tech).
- `specs/<NNN>-<name>/plan.md` — HOW (architecture, data models, contracts).
- `specs/<NNN>-<name>/tasks.md` — sequential, individually-committable steps.

Commits follow `<type>(phase-N/TX): <imperative>` (e.g. `feat(phase-1/T7): ...`), one logical change each. Spec changes commit separately from implementation.

## Commands

All from repo root unless noted. Package manager is **pnpm 10.12.4** (not npm).

```bash
pnpm install                     # install all workspaces
pnpm lint                        # eslint . (whole repo)
pnpm lint:fix
pnpm format:check                # prettier --check (CI runs this; must pass)
pnpm format                      # prettier --write
pnpm typecheck                   # tsc --noEmit across all workspaces
pnpm test                        # vitest run across all workspaces
pnpm build
```

Single workspace / single test:

```bash
pnpm -F @f1/shared test          # one workspace's tests
pnpm -F @f1/infra test
pnpm -F @f1/infra test:watch
pnpm -F @f1/infra vitest run __tests__/pipeline-stack.test.ts   # single file
pnpm -F @f1/infra vitest run -t "DLQ"                           # single test by name
```

CDK (infra), needs AWS creds — `AWS_PROFILE` from your `.env`:

```bash
AWS_PROFILE=<profile> pnpm -F @f1/infra cdk synth
AWS_PROFILE=<profile> pnpm -F @f1/infra cdk diff
AWS_PROFILE=<profile> pnpm -F @f1/infra cdk deploy F1-DataLayer F1-Pipeline
```

CI (`.github/workflows/ci.yml`) runs: eslint, prettier check, typecheck, vitest, and `cdk synth`. All must be green on `main`.

## Workspace layout

pnpm workspaces: `apps/*`, `infra`, `packages/*`. The `ml/` dir is **not** in the pnpm workspace — it's a separate Python toolchain (uv/pip) added in Phase 3.

- `packages/shared` (`@f1/shared`) — **single source of truth** for cross-cutting types. Zod schemas, S3 path builders, DDB key helpers. Both apps and infra import from here. Per Constitution III, no duplicated schema/path/key logic anywhere else.
- `infra` (`@f1/infra`) — AWS CDK v2 (TypeScript, ESM). Four stacks; Lambda sources live in `infra/lambda/<name>/`.
- `apps/dashboard` (Phase 2), `apps/predictor` (Phase 4) — Next.js frontends, both deployed on Vercel (one Vercel project each, root = the app dir).
- `ml` — Python ML workspace + OpenF1 fixtures in `ml/fixtures/openf1/<session_key>/`.

## Architecture essentials

**Four CDK stacks** (`infra/bin/app.ts`):

- `DataLayerStack` (Phase 0) — the S3 bucket. `RemovalPolicy.RETAIN` — it holds the only copy of the live archive; a stack destroy must never delete it.
- `PipelineStack` (Phase 1) — the ingest path: DynamoDB `F1Live` (single-table, TTL, Streams, on-demand), SQS `F1-Events` + DLQ, 4 Lambdas, EventBridge rules, the shared SNS `f1-alerts` topic, CloudWatch dashboard + alarms.
- `RealtimeStack` (Phase 2) — WebSocket API Gateway + 6 Lambdas (Connect/Disconnect/Authorizer/Subscribe/Fanout/Replay), `F1Connections` table, HMAC auth (`WS_TOKEN_SECRET` from SSM), `f1-realtime` dashboard. Fans the `F1Live` stream out to the dashboard.
- `InferenceStack` (Phase 4) — the predictor: `F1Predictions` table (on-demand, **RETAIN, no TTL** — Phase 5 reads it back), a **Docker/Python** `DockerImageFunction` (XGBoost + Bedrock Claude Haiku 4.5, T-60min pre-race trigger via `Schedule-Sync`), and the `F1-Predictions-Api` Read-API (Node λ behind a CORS-scoped Function URL — the predictor frontend's only data path). `f1-inference` dashboard. Reads `models/<version>/{model.json,history.csv}` from the shared bucket — history is precomputed so inference only fetches the upcoming quali live (avoids FastF1/Ergast's 500-calls/h limit).

**Ingest flow:** `Schedule-Sync λ` (daily 04:00 cron) reads OpenF1 `/sessions` and programs an aws-scheduler schedule per upcoming session → `Poller λ` (5s during sessions only, never 24/7) → `SQS+DLQ` → `Consumer λ` → DynamoDB `F1Live` + S3 `raw/sessions/.../parts/` → `Archiver λ` (15min cron) consolidates parts into one `.jsonl`.

**Validation is double (Constitution VI):** Poller validates OpenF1 responses with the per-endpoint Zod schema on the way in; Consumer re-validates on the way out. SQS message shape is `PipelineEventSchema` with a `schema_version` literal so a partial deploy rejects stale messages instead of misreading them. Schema drift must fail loudly, never silently.

**Lambda handler pattern:** pure logic lives in `handler.ts` (dependency-injected — `fetch`, `sendMessage`, `now`, `sleep`, `emitMetric` passed in) so unit tests drive it without the AWS SDK; `index.ts` is the thin Lambda entrypoint that wires real AWS clients. The integration test (`infra/__tests__/pipeline.integration.test.ts`) drives Poller→Consumer→Archiver in-memory against real OpenF1 fixtures.

**Never hand-build keys or paths.** S3 keys come from `S3_PATHS` in `@f1/shared/s3-layout`; DDB PK/SK come from the helpers in `@f1/shared/ddb-keys` (`sessionPK`, `lapSK`, etc.). Lap/stint numbers are zero-padded in SKs to keep range scans sorted. Live DDB rows get a 24h TTL (`expiresAt`); S3 is the durable copy, DDB is the hot cache.

## Conventions & gotchas

- **TypeScript ESM everywhere** — `"type": "module"`, `moduleResolution: NodeNext`. Relative imports need the `.js` extension even from `.ts` source (e.g. `import ... from "./ddb-keys.js"`).
- **Strict tsconfig** (`tsconfig.base.json`): no `any`, no `@ts-ignore` without a justifying comment (Constitution VI), `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. The infra workspace is the _only_ place `exactOptionalPropertyTypes` is disabled — required by CDK's `IBucket`/`IFunction` interfaces; all other strictness stays on.
- **Imports are auto-sorted** by `simple-import-sort` (eslint error). Type imports must use inline `import { type X }`.
- **`no-console` is warn** repo-wide but **off** in `infra/lambda/**` — Lambdas log to CloudWatch via `console`. Lambda logging should be structured JSON (Constitution VIII).
- Lambdas: Node 20, ARM64, ESM bundle via esbuild, `@aws-sdk/*` marked external (provided by the runtime — don't bundle it).
- **Cost control is mandatory** (Constitution IV): a budget alarm must exist before any Lambda deploy; polling runs only during sessions; DDB on-demand + TTL; Bedrock calls cached. Every plan documents its €/month footprint.
- **Every Lambda needs a CloudWatch alarm** on failure/silence before it's "done" (Constitution VIII).
- ML model artifacts go to S3 `models/<semver>/` (never `latest/`), each with a `model_card.md` (Constitution IX) and a `history.csv` (precomputed rolling feature history the inference λ loads instead of re-querying FastF1). Keys come from `S3_PATHS` in `@f1/shared/s3-layout` / its Python mirror `f1pred/layout.py` — never hand-build them.
- `README.md` must stay current — it's the recruiter-facing entry point (Constitution XII).
