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

## T3 — Fixture-Sammlung

- **Output:** `ml/fixtures/openf1/<session_key>/<endpoint>.json` pro Endpoint einer historischen Session (z.B. Bahrain Race 2024). Skript `ml/scripts/fetch_fixtures.py` zum Reproduzieren.
- **Verify:** Fixtures validieren gegen die T2-Schemas.

## T4 — CDK `PipelineStack` Skelett

- **Output:** `infra/lib/pipeline-stack.ts` mit leeren Konstrukten für: DynamoDB Table, SQS Queue + DLQ, alle 4 Lambdas (mit Dummy-Code), EventBridge-Rule. `bin/app.ts` instanziiert den Stack.
- **Verify:** `cdk synth PipelineStack` läuft.

## T5 — DynamoDB Table (Single-Table)

- **Output:** Table-Definition in `pipeline-stack.ts` mit PK/SK, TTL-Attribut, Stream `NEW_AND_OLD_IMAGES`, On-Demand.
- **Verify:** Snapshot-Test des synthetisierten Templates.

## T6 — SQS Queue + DLQ

- **Output:** Standard-Queue + DLQ, Redrive Policy MaxReceiveCount=3, Visibility Timeout 60s, Retention 1d / 7d.
- **Verify:** Snapshot-Test.

## T7 — Poller Lambda (Code + Tests)

- **Output:** `infra/lambda/poller/index.ts` mit Logik aus Plan §3. Unit-Tests für Backoff, Endpoint-Dispatch, Zod-Validierung.
- **Verify:** Tests grün. Lokal mit Fixture als HTTP-Mock ausführbar.

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
