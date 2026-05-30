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

## T8 — Consumer Lambda (Code + Tests) — DONE

- **Output:** `handler.ts` (pure DI) + `index.ts` (real AWS clients). Pro Batch: Envelope + per-Endpoint Validation → `rowToSK()` aus `@f1/shared` zur DDB-Item-Construction → BatchWriteItem-Chunks zu 25 → ein S3-Part pro Batch unter `raw/sessions/<date>/<session>/parts/`. `reportBatchItemFailures: true` für SQS Partial-Batch-Retry.
- **Verify:** 13 neue Tests — Happy Path, TTL, EventsArchived-Metric, Envelope+Payload Schema-Fails, Wrong schema_version, Non-JSON, Unroutable Rows (stint#xx#nn), DDB/S3 throws.

## T9 — Archiver Lambda (Code + Tests) — DONE

- **Output:** `handler.ts` (pure DI) + `index.ts` (S3 list/head/get/put/delete). Pro Session-Folder: skippt wenn Finale schon existiert (Idempotenz), skippt wenn newest part < 30 Min alt (still active), sonst merged alle Parts sortiert nach `fetched_at + endpoint` zur finalen JSONL und löscht Parts. Robust gegen unparseable Lines.
- **Verify:** 5 Tests — Happy-Path-Merge mit Order, Skip-Existing, Skip-Still-Active, No-Parts, Malformed-Line-Tolerance. Trigger: `events.Rule rate(15 min)`.

## T10 — Schedule-Sync Lambda (Code + Tests) — DONE

- **Output:** `handler.ts` (pure DI) + `index.ts` (`@aws-sdk/client-scheduler`). Täglich um 04:00 UTC: fetch `/sessions?year=<current>`, filter cancelled + outside 48h horizon, upsert pro Session ein `f1-poll-<key>`-Schedule mit Window `[start-15min, end+30min]` und Target = Poller-Lambda (eigene IAM-Rolle für scheduler.amazonaws.com). Sweep stale schedules, aber nie eines löschen das gerade läuft.
- **Verify:** 7 Tests — Horizon-Filter, Cancelled-Skip, Completed-Skip, Cleanup-Stale, Never-Delete-Running, Bad-Response-Tolerance, Schema-Fail per Row.

## T11 — Wiring: Lambdas in Stack einhängen — DONE

- **Output:** Alle 4 Lambdas als `NodejsFunction` (ESM, ARM64, esbuild bündelt, `@aws-sdk/*` extern weil Runtime-provided). Consumer hat SqsEventSource (Batch 10, MaxBatching 5s, partial failures). Archiver hängt an `Schedule.rate(15min)`. Schedule-Sync auf `cron 04:00 UTC`. Least-privilege Grants: `eventsQueue.grantSendMessages(poller)`, `liveTable.grantWriteData(consumer)`, `dataBucket.grantPut(consumer, "raw/sessions/*/parts/*")`, `dataBucket.grantReadWrite(archiver, ...)`, scheduler-invoke role mit `lambda:InvokeFunction` auf Poller, scheduleSync mit `scheduler:*` + `iam:PassRole`.
- **Verify:** `cdk synth` grün, alle 47 infra-Tests (inkl. T5+T6) bleiben grün.

## T12 — Integrationstest — DONE (Plan-B: pures Mocking)

- **Output:** `infra/__tests__/pipeline.integration.test.ts` — Poller → in-memory SQS → Consumer → in-memory DDB/S3 → Archiver, **mit echten Fixtures aus T3**. End-Assertions: 5 SQS-Messages, korrekte DDB-Items (PK `session#11291`, weather-Singleton, lap-SKs zero-padded), 1 S3-Part mit 5 JSONL-Zeilen, Archiver konsolidiert chronologisch sortiert, Parts werden gelöscht.
- **Verify:** Test grün. Beweist End-to-End-Determinismus ohne LocalStack-Overhead.

## T13 — CloudWatch Dashboard + Alarme — DONE

- **Output:**
  - SNS-Topic `f1-alerts` mit Email-Subscription auf `martin_schweiger@outlook.de`.
  - 4 Alarme: `F1-DLQ-Depth` (>0), `F1-Poller-ErrorRate` (>5% via MathExpression), `F1-Consumer-ErrorRate` (>5%), `F1-ScheduleSync-Failure` (>0 errors in 15 min). Alle melden an SNS.
  - Dashboard `f1-pipeline` mit 4 Widgets: SQS-Tiefe (events vs DLQ rot), Lambda-Invocations aller 4, Lambda-Errors farbcodiert, DDB-Consumed-Capacity.
- **Verify:** `cdk synth` grün. Email-Subscription muss nach T14-Deploy in der Mail bestätigt werden (Plan §Notification).

## T14 — Deploy in `eu-central-1` — DONE

- **Output:** `F1-Pipeline` Stack mit 39 Ressourcen deployed (CREATE_COMPLETE in 3 Min). Lambdas live (`F1-Poller`, `F1-Consumer`, `F1-Archiver`, `F1-ScheduleSync`), DDB `F1Live` ACTIVE, SNS `f1-alerts` subscription bestätigt.
- **Verify:** `aws lambda invoke F1-ScheduleSync` → `{"ok":true,"result":{"upserted":[],"deleted":[],"skipped":0}}` — Pipeline funktioniert, OpenF1 hat aktuell aber 0 Sessions in den nächsten 48h (nächstes F1-Wochenende ist erst in einigen Wochen).

## T15 — Erste Live-Session — VERTAGT

- **Status:** Pipeline ist deployed und schedule-sync läuft täglich 04:00 UTC. Beim nächsten F1-Wochenende wird automatisch alles getriggert.
- **Was zu tun ist beim nächsten Renn-Wochenende:** Nach dem ersten Free-Practice prüfen:
  1. `aws s3 ls s3://f1-data-128663321407-eu-central-1/raw/sessions/ --recursive` — sollte Parts + finale JSONL zeigen
  2. `aws dynamodb scan --table-name F1Live --max-items 5` — sollte während Session Daten zeigen, danach (24h TTL) leer
  3. CloudWatch Dashboard `f1-pipeline` — alle Lambdas haben Invocations
  4. Cost Explorer nach 24h: ≤ 1 € (AC-8)

## T16 — Silence-Alarm-Test — VERTAGT

- **Status:** Wird beim ersten Live-Wochenende mitverifiziert. Während aktiver Polling-Rule die Rule manuell disablen (`aws scheduler update-schedule --state DISABLED ...`), 15 Min warten, Mail erwarten, Rule wieder aktivieren.

## T17 — Phase-1-Abschluss — DONE (modulo T15/T16 Live-Beobachtung)

- README Spec-Status `Data Pipeline → ✅ deployed`. Architektur-Diagramm aktualisiert (was jetzt live ist). `git tag phase-1-done`.
- T15/T16 Live-Validierung kommt automatisch beim nächsten F1-Wochenende — keine Code-Änderung mehr nötig.
