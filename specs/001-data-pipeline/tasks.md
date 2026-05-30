# Tasks: Data Pipeline

> **Plan:** [plan.md](./plan.md)
> **Status:** ready

Reihenfolge bewusst: Schemas → Stacks → Lambdas → Wiring → Live-Test.

## T1 — OpenF1-Erkundung (Spike) — DONE

- **Output:** [docs/openf1-notes.md](../../docs/openf1-notes.md) mit allen 6 Endpoints, Sample-Responses, Rate-Limit-Verhalten (~4 RPS), Session-Aktiv-Detektor, Stolperfallen.
- **Verify:** Alle 6 Endpoints per `curl` gegen Session 11291 (Montréal Race 2026-05-24) erfolgreich abgefragt.
- **Spike-Befunde, die ins Plan gewandert sind:**
  - `/position` ist **singular**, nicht `/positions` (kostet sonst einen ganzen Test-Zyklus).
  - Rate-Limit ist Token-Bucket-artig: 4 RPS Burst, dann 429 mit `Retry-After: 1`. Sequentielle Fetches im Poller ausreichend (5 × 100ms = 500ms pro Tick).
  - Live-Datenfelder sind oft `null` (laufende Rundenzeiten etc.) → Zod-Schemas konsequent `nullable()`.

## T2 — Zod-Schemas in `packages/shared` — DONE

- **Output:**
  - `src/openf1-schema.ts` mit 6 Schemas (`SessionSchema`, `PositionSchema`, `IntervalSchema`, `LapSchema`, `StintSchema`, `WeatherSchema`), `ENDPOINT_PAYLOAD_SCHEMAS`-Lookup, `isSessionActive()`.
  - `src/event-schema.ts` mit `PipelineEventSchema` + `PIPELINE_EVENT_SCHEMA_VERSION`.
  - `src/ddb-keys.ts` mit `sessionPK`, `metaSK`, `driverPositionSK`, `driverIntervalSK`, `lapSK` (zero-padded 4), `stintSK` (zero-padded 2), `weatherSK`, `ttlEpochSeconds`.
  - 31 Vitest-Tests in `__tests__/` mit echten Fixtures aus T1 (Montréal Race) + Failure-Cases.
- **Verify:** `pnpm -F @f1/shared test` → 31 pass. `pnpm typecheck` grün (Tests sind jetzt auch im tsc-Scope durch `rootDir: "."`).
- **CI:** Test-Step im `ts`-Job hinzugefügt.

## T3 — Fixture-Sammlung — DONE

- **Output:**
  - `ml/scripts/fetch_fixtures.py` — pure Python (stdlib + optional certifi), auto-detects latest race wenn `--session` weggelassen, samplet `position/intervals/laps` auf 100 Rows (`--full` für unsampled).
  - `ml/fixtures/openf1/11291/{session,position,intervals,laps,stints,weather}.json` (172 KB total — Montréal Race 2026-05-24).
  - `packages/shared/__tests__/fixtures.test.ts` — validiert alle 6 Files gegen die T2-Schemas, läuft in CI.
- **Verify:** 37 Tests grün. Ein echter Schema-Drift wurde entdeckt + gefixt: `segments_sector_*` enthält `null`-Einträge IM Array, nicht nur als ganzer Wert (in `openf1-notes.md` dokumentiert).

## T4 — CDK `PipelineStack` Skelett — DONE

- **Output:** `infra/lib/pipeline-stack.ts` mit leerer `PipelineStack`-Klasse + `PipelineStackProps` (nimmt `dataBucket` von `DataLayerStack` als cross-stack Reference). `bin/app.ts` instanziiert den Stack und verdrahtet `dataLayer.dataBucket` → `pipeline.dataBucket`. Phase=1 Tag am Stack.
- **Verify:** `cdk list` zeigt `F1-DataLayer` + `F1-Pipeline`. `cdk synth --quiet` grün.
- **Stolperfalle:** `exactOptionalPropertyTypes: true` ist mit CDKs `IBucket`/`IFunction`-Interfaces inkompatibel (`isWebsite: boolean | undefined`). Lokal in `infra/tsconfig.json` ausgeschaltet — alle anderen strict-Flags bleiben an.

## T5 — DynamoDB Table (Single-Table) — DONE

- **Output:**
  - `F1LiveTable` als `dynamodb.TableV2` in `PipelineStack`: PK/SK über `PK_ATTR`/`SK_ATTR`/`TTL_ATTR` aus `@f1/shared` (Constitution III), Billing On-Demand, TTL auf `expiresAt`, Stream `NEW_AND_OLD_IMAGES`, RemovalPolicy DESTROY (S3-Archiv ist Truth-Layer).
  - Vitest in `infra/` eingerichtet, 7 Assertion-Tests gegen das synthetisierte Template (KeySchema, Billing, TTL, Stream, Removal, Resource-Count, Phase-Tag).
- **Verify:** `pnpm -F @f1/infra test` → 7 pass. `pnpm -r test` insgesamt 44 grün.
- **Stolperfalle:** TableV2 nested die Tags pro Replica (`Replicas[*].Tags`), nicht auf Root-Level wie bei TableV1.

## T6 — SQS Queue + DLQ — DONE

- **Output:** `EventsQueue` (Standard, 1d retention, 60s visibility timeout, enforceSSL) + `EventsQueueDLQ` (7d retention, enforceSSL). Redrive: `maxReceiveCount=3`. Beide queueNamed (`F1-Events`, `F1-Events-DLQ`).
- **Verify:** 5 neue Assertion-Tests in `pipeline-stack.test.ts` — Queue-Count, Namen, Retention, Visibility, Redrive-Policy, TLS-Deny via SQS-QueuePolicy. 12 infra tests grün, 49 total.

## T7 — Poller Lambda (Code + Tests) — DONE

- **Output:**
  - `infra/lambda/poller/handler.ts` — reine, DI-fähige Logik: sequenzielles Polling (Spike: ~4 RPS Limit), Exp. Backoff mit `Retry-After`-Header (max 3 Versuche), per-Endpoint Zod-Validierung, einzelne SQS-Message pro Endpoint mit `PipelineEvent`-Shape.
  - `infra/lambda/poller/index.ts` — Lambda-Entrypoint, baut `SQSClient` + `globalThis.fetch` als Deps, strukturiertes JSON-Logging für CloudWatch.
  - `shouldPollWeather(now)` — stateless 30s-Cadence via `seconds % 30 < 5`, ohne DDB-Roundtrip.
  - 17 neue Vitest-Tests gegen mocked fetch + sendMessage: happy path (5 Endpoints), Weather-Skip-Cadence, PipelineEvent-Shape, 429-Backoff-Success + Give-Up, Schema-Fail, Network-Error, Endpoint-URL-Helper.
- **Verify:** 24 infra tests + 37 shared = **61 total**, alle grün.
- **ESLint:** `no-console: off` für `infra/lambda/**` — Lambdas loggen idiomatisch via `console.log` nach CloudWatch.

## T8 — Consumer Lambda (Code + Tests)

- **Output:** `infra/lambda/consumer/index.ts` mit Logik aus Plan §5. DDB-Writes per Document Client, S3-PutObject pro Tick. Unit-Tests mit gemockten AWS-SDKs.
- **Verify:** Tests grün. Schema-Fail führt zu Item in Batch-Item-Failures (SQS-Konvention).

## T9 — Archiver Lambda (Code + Tests)

- **Output:** `infra/lambda/archiver/index.ts` — listet Parts, sortiert, merged, schreibt finale JSONL, löscht Parts. Idempotent.
- **Verify:** Test: zwei Aufrufe nacheinander → zweiter Aufruf macht nichts (kein Duplikat).

## T10 — Schedule-Sync Lambda (Code + Tests)

- **Output:** `infra/lambda/scheduleSync/index.ts` — fetcht OpenF1 `sessions`, konvertiert zu Scheduler-Windows, programmiert `aws-scheduler` Schedules.
- **Verify:** Unit-Test mit Fixture-Sessions: korrekte Anzahl Schedules, Zeitfenster ±15/+30 Min.

## T11 — Wiring: Lambdas in Stack einhängen

- **Output:** Alle Lambdas im Stack: Code-Asset gebaut (esbuild), Permissions (Plan §Security), SQS-EventSource für Consumer, EventBridge-Rule → Poller, EventBridge-Schedule → Archiver, Cron → Schedule-Sync.
- **Verify:** `cdk synth` zeigt vollständigen Stack mit allen Verbindungen. Snapshot-Test.

## T12 — Integrationstest mit LocalStack

- **Output:** `infra/__tests__/pipeline.integration.test.ts` — startet LocalStack, deployed (oder mocked) Pipeline, schickt Fixture-Events durch, assert Endzustand in DDB + S3.
- **Verify:** `pnpm -F infra test` grün.
- **Notes:** Wenn LocalStack zu schwer wird → Plan-B: pures Mocking mit aws-sdk-client-mock.

## T13 — CloudWatch Dashboard + Alarme

- **Output:** Dashboard `f1-pipeline` als CDK-Code, 4 Alarme aus Plan §Observability, SNS-Topic `f1-alerts` mit Email-Subscription.
- **Verify:** `cdk synth` enthält alle. Email-Subscription nach Deploy bestätigen.
- **Constitution:** VIII.

## T14 — Deploy in `eu-central-1`

- **Output:** `cdk deploy PipelineStack` erfolgreich. AWS-Konsole zeigt alle Ressourcen.
- **Verify:** Manuell einen Test-Event via `aws sqs send-message` schicken, beobachten ob Consumer ihn verarbeitet.

## T15 — Erste Live-Session

- **Output:** Polling-Rule für ein konkretes anstehendes Free-Practice manuell enablen. Nach Ende: S3 zeigt finale JSONL, DDB war live, ist nach TTL leer.
- **Verify:** JSONL chronologisch sortiert (AC-9). Cost-Report unter 1 €.
- **Notes:** Datum eintragen wenn klar. Erstes Event genug — Predictor-Phase braucht eh historische Daten.

## T16 — Silence-Alarm-Test

- **Output:** Während aktiver Polling-Rule die Rule manuell deaktivieren, 15 Min warten, Alarm-Mail empfangen, Rule wieder enablen.
- **Verify:** Mail im Posteingang.

## T17 — Phase-1-Abschluss

- **Output:** README Spec-Status `Data Pipeline → done`. Architektur-Diagramm im README aktualisiert (was jetzt live ist). `git tag phase-1-done`.
- **Verify:** Recruiter-Test: jemand öffnet das Repo und versteht aus README + Diagramm, was die Pipeline tut.
