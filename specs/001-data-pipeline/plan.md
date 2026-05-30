# Plan: Data Pipeline

> **Spec:** [spec.md](./spec.md)
> **Status:** approved

## Architektur

```
                        ┌──────────────┐
                        │  OpenF1 API  │  (public, no auth)
                        └───────┬──────┘
                                │  HTTPS (poll)
                                ▼
┌──────────────────┐    ┌──────────────┐    ┌──────────────────┐
│  EventBridge     │───▶│  Poller λ    │───▶│  SQS Standard    │──┐
│  rate(5 sec)     │    │  (TS)        │    │  + DLQ           │  │
│  enabled only    │    │  validates   │    └──────────────────┘  │
│  during sessions │    │  via Zod     │                          │
└──────────────────┘    └──────────────┘                          │
        ▲                                                         │
        │ Schedule-Sync λ (daily cron)                            │
        │  reads OpenF1 sessions, sets rule windows               │
        │                                                         ▼
        │                              ┌──────────────────────────────┐
        │                              │  Consumer λ (TS, batch)      │
        │                              │  • writes live state to DDB  │
        │                              │  • buffers events for archive│
        │                              └─────┬───────────────────┬────┘
        │                                    │                   │
        │                                    ▼                   ▼
        │                              ┌──────────┐       ┌──────────────┐
        │                              │ DynamoDB │       │  S3 Bucket   │
        │                              │ (TTL 24h)│       │  raw/sessions│
        │                              └─────┬────┘       │     .jsonl   │
        │                                    │            └──────────────┘
        │                                    │ (Phase 2)
        │                                    ▼
        │                              [ DDB Stream ]→[ WS API ]
        │
   CloudWatch: alarms (silence, errors, DLQ-depth)
```

## Komponenten

### 1. EventBridge Polling Rule (`PollingRule`)

- **Verantwortung:** Triggert die Poller-Lambda alle 5 Sekunden — **nur** während aktiver Sessions.
- **Trigger:** `rate(5 seconds)` (oder `cron`-basiert mit Zeitfenster).
- **State:** über die Schedule-Sync-Lambda enabled/disabled.

### 2. Schedule-Sync Lambda (`scheduleSync.ts`)

- **Verantwortung:** Liest 1×/Tag (cron `0 4 * * ? *` UTC) die OpenF1 `sessions`-Liste für die nächsten 48h. Für jede Session: berechnet Start −15min und Ende +30min, programmiert das als EventBridge-Schedule-Window für `PollingRule` (Enable/Disable per `enable_rule` / `disable_rule`-Calls oder besser: eine `aws-scheduler.Schedule` pro Session mit Window).
- **Runtime:** Node 20 (TypeScript).
- **In:** Cron-Event.
- **Out:** AWS-API-Calls auf EventBridge Scheduler.
- **Failure-Mode:** Bei Fehler → CloudWatch-Alarm (sonst läuft Pipeline am Renn-Wochenende nicht an). Idempotent (mehrfach ausführbar ohne Duplikate).

### 3. Poller Lambda (`poller.ts`)

- **Verantwortung:** Eine Iteration = ein Snapshot. Holt parallel `positions`, `intervals`, `laps`, `stints` (alle 5s). `weather` nur jeden 6. Tick (also 30s).
- **Runtime:** Node 20, ARM64 (billiger), 256 MB, Timeout 10s.
- **In:** EventBridge-Event (ignoriert Body, ermittelt aktive Session aus DynamoDB-Lookup oder eigener Logik).
- **Out:** für jeden API-Response → Zod-validierte Events in SQS (eine Message pro Endpoint-Response, nicht pro Event — Batching für Cost). Message-Body: `{ session_id, endpoint, payload, fetched_at }`.
- **Failure-Mode:**
  - HTTP 429 → exponential backoff (max 2 Retries innerhalb der Lambda-Invocation), dann skip dieser Tick.
  - HTTP 5xx → log, skip.
  - Zod-Fail beim _Request-Sending_ (sollte nie passieren) → throw, Lambda meldet Error.
- **HTTP-Client:** `undici` (built-in seit Node 20, kein Extra-Bundle).

### 4. SQS Queue (`EventsQueue`) + DLQ

- **Type:** Standard (Ordnung wird beim S3-Write hergestellt, siehe Spec R-5).
- **Visibility Timeout:** 60s (Consumer-Lambda Timeout × ~6 für Retries).
- **MessageRetention:** 1 Tag (lange genug für Backlog-Aufholen, kurz genug für Cost).
- **DLQ:** `EventsQueueDLQ`, MaxReceiveCount 3. Retention 7 Tage (zum Debuggen).
- **Alarm:** `ApproximateNumberOfMessagesVisible` auf DLQ > 0 → Alarm.

### 5. Consumer Lambda (`consumer.ts`)

- **Verantwortung:** Liest SQS-Batches (BatchSize 10, MaxBatchingWindow 5s). Pro Message:
  1. Validiert Payload-Schema (zweite Stufe nach Poller — Defense in Depth, weil Schema in Storage anders aussehen kann als im Transport).
  2. Schreibt Live-Items in DynamoDB (BatchWriteItem).
  3. Appended ein JSONL-Line in einen Lambda-lokalen Buffer pro `session_id`, der am Ende der Invocation als Multipart-Append nach S3 geschrieben wird (kleines Subtility: S3 hat kein "append" — Strategie unten).
- **Runtime:** Node 20, ARM64, 512 MB, Timeout 30s.
- **In:** SQS-Batch.
- **Out:** DynamoDB-Writes, S3-Object-Writes.
- **Failure-Mode:**
  - Zod-Fail → diese Message in DLQ (return failed message ID im Batch-Response). Metric `SchemaValidationFailure` mit Endpoint-Dimension.
  - DDB/S3 Throttle → ganzer Batch failed → SQS-Retry.
- **S3-Append-Strategie:**
  - Pro Tick wird ein eigenes Part-Object geschrieben: `raw/sessions/<date>/<session>/parts/<ts>-<msgid>.jsonl`.
  - Eine separate **Archiver-Lambda** (Step Functions oder Schedule) konsolidiert nach Session-Ende alle Parts in eine einzige sortierte `<session_id>.jsonl` und löscht die Parts.
  - Alternative überlegt: DynamoDB Streams → Kinesis Firehose → S3 (mit Buffering). Verworfen für Phase 1: zu viele Moving Parts, höhere Kosten. Die einfache Lösung reicht.

### 6. Archiver Lambda (`archiver.ts`)

- **Verantwortung:** Erkennt Session-Ende (30 Min ohne neue Events für eine `session_id`), liest alle Parts aus S3, sortiert per `fetched_at + endpoint`, schreibt finale JSONL, löscht Parts.
- **Trigger:** EventBridge-Schedule `rate(15 minutes)` — leichtgewichtig.
- **In:** Schedule-Tick.
- **Out:** Konsolidiertes S3-Object.
- **Failure-Mode:** Idempotent — wenn finale Datei schon existiert, überspringen.

### 7. DynamoDB Table (`F1LiveTable`)

- **Single-Table-Design:**
  - `PK = session#<session_id>` (String)
  - `SK = <entity>#<...>` (String)
  - Beispiele:
    - `entity=meta`, SK = `meta` → Session-Metadaten (date, type, status, last_event_at).
    - `entity=driver`, SK = `driver#44#position` → letzte Position pro Fahrer.
    - `entity=lap`, SK = `lap#44#0042` → einzelne Runde (für Replay).
    - `entity=stint`, SK = `stint#44#03` → Stints.
  - Attribut `expiresAt` (Number, epoch sec) → TTL aktiviert. Default = `now + 86400`.
- **Capacity:** On-Demand (Constitution IV).
- **Streams:** `NEW_AND_OLD_IMAGES` (Phase 2 wird konsumieren).
- **GSI:** vorerst keiner — kommt in Phase 2 falls nötig.

### 8. CloudWatch (Logs, Metrics, Alarms)

- **Log-Gruppen:** `/f1/poller`, `/f1/consumer`, `/f1/scheduleSync`, `/f1/archiver`. Retention 14 Tage.
- **Custom Metrics:**
  - `SchemaValidationFailure` (Count, Dimension: endpoint).
  - `EventsArchived` (Count, Dimension: session_id).
  - `PollerRequestLatency` (ms, Dimension: endpoint).
- **Alarms:**
  - **`FeedSilenceAlarm`:** keine erfolgreichen Consumer-Invocations für 15 Min während `PollingRule` enabled.
  - **`DLQDepthAlarm`:** DLQ > 0.
  - **`PollerErrorRateAlarm`:** Lambda Errors > 5% über 5 Min.
  - **`ScheduleSyncFailureAlarm`:** Sync-Lambda failed.
- **Notification:** SNS-Topic `f1-alerts` → Email `martin@michelberger.digital`.

## Datenmodelle

### `packages/shared/src/openf1-schema.ts`

Zod-Schemas pro OpenF1-Endpoint. Beispiel:

```ts
export const PositionSchema = z.object({
  session_key: z.number(),
  meeting_key: z.number(),
  driver_number: z.number(),
  date: z.string().datetime(),
  position: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;
```

### `packages/shared/src/event-schema.ts`

SQS-Message-Shape:

```ts
export const PipelineEventSchema = z.object({
  session_id: z.string(),
  endpoint: z.enum(["positions", "intervals", "laps", "stints", "weather"]),
  payload: z.unknown(), // wird im Consumer per endpoint-spezifischem Schema validiert
  fetched_at: z.string().datetime(),
  schema_version: z.literal(1),
});
```

### `packages/shared/src/ddb-keys.ts`

Helpers für PK/SK-Konstruktion — kein Magic-String-Streuen.

## Externe Verträge

- **OpenF1:** Basis-URL `https://api.openf1.org/v1`. Endpoints `sessions`, `positions`, `intervals`, `laps`, `stints`, `weather`. Query-Param immer `session_key=<n>`. Public, kein Auth.
- **AWS SDK v3:** `@aws-sdk/client-sqs`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` (Document Client), `@aws-sdk/client-s3`, `@aws-sdk/client-cloudwatch`.

## Security & IAM

Pro Lambda eine eigene IAM-Rolle (least privilege):

- **PollerRole:** `sqs:SendMessage` auf `EventsQueue`, `cloudwatch:PutMetricData`.
- **ConsumerRole:** `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` auf `EventsQueue`, `dynamodb:BatchWriteItem/PutItem/UpdateItem` auf `F1LiveTable`, `s3:PutObject` auf `arn:aws:s3:::<bucket>/raw/sessions/*/parts/*`, `cloudwatch:PutMetricData`.
- **ArchiverRole:** `s3:ListBucket/GetObject/PutObject/DeleteObject` auf `raw/sessions/*`.
- **ScheduleSyncRole:** `scheduler:CreateSchedule/UpdateSchedule/DeleteSchedule/ListSchedules`.

Keine Secrets in Phase 1 (OpenF1 ist key-frei).

## Observability

Strukturierte Logs (JSON via `pino` oder Lambda-PowerTools-TS):

```json
{
  "level": "info",
  "msg": "poll.endpoint.ok",
  "endpoint": "positions",
  "session_id": "9158",
  "latency_ms": 287,
  "count": 20
}
```

Korrelations-ID = `session_id + tick_id` (Hash aus fetched_at + endpoint).

Dashboard `f1-pipeline` mit:

- SQS-Tiefe (Live + DLQ)
- Lambda-Invocations + Errors (alle 4)
- Custom-Metrics
- Letzter erfolgreicher Poll (X min ago)

## Kosten-Footprint

Annahme: 20 Renn-Wochenenden × 2h Race + 1h Quali + 3×1h Practice ≈ 6h/Wochenende × 20 = 120h/Jahr aktives Polling.

| Service            | Posten                                                  | €/Jahr           |
| ------------------ | ------------------------------------------------------- | ---------------- |
| Lambda (Poller)    | 720 Tick/h × 120h = 86.400 Invocations × 256MB × ~500ms | ~0,30            |
| Lambda (Consumer)  | ähnliche Größenordnung                                  | ~0,50            |
| SQS                | 86.400 × ~5 Endpoints = 432k Requests                   | gratis (1M frei) |
| DynamoDB On-Demand | ~500k Writes + 100k Reads                               | ~0,80            |
| S3 PutObjects      | 86.400 Parts → konsolidiert                             | ~0,40            |
| S3 Storage         | 100 GB max                                              | ~2,50            |
| CloudWatch Logs    | 14d Retention                                           | ~1,00            |
| **Gesamt**         |                                                         | **~5,50 €/Jahr** |

→ Pro 2h-Rennen ≪ 1 € (AC-8 ✓).

## Test-Strategie

- **Unit:** Zod-Schemas (Happy + Failure-Cases), DDB-Key-Helpers, S3-Path-Helpers, Poller-Backoff-Logik (mit Fake Timers).
- **Integration (LocalStack):** End-to-End-Lauf mit Fixture-OpenF1-Responses (gespeicherte JSON-Files aus echtem API-Call). Asserts: SQS bekam N Messages, DDB hat N Items, S3 hat N Parts.
- **Fixture-Sammlung:** `ml/fixtures/openf1/` mit gespeicherten Responses einer historischen Session. Wird auch Phase 3 helfen.
- **Manueller E2E:** Erstes Free-Practice-Wochenende = Live-Test. Vorher Polling-Rule manuell aktivieren, nach 1h schauen ob Daten ankommen.

## Abweichungen von der Constitution

Keine.
