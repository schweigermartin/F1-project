# Plan: Live Dashboard

> **Spec:** [spec.md](./spec.md)
> **Status:** implemented (T1–T13); deploy ausstehend (T14, [runbook](../../docs/phase-2-deploy.md))

## Architektur

Ein neuer Stack `RealtimeStack` (`F1-Realtime`) hängt an die in Phase 1 gebauten Bausteine an: er konsumiert den **DDB-Stream** der `F1Live`-Tabelle und liest aus dem **S3-Archiv** (beide als Cross-Stack-Props übergeben, genau wie `PipelineStack` schon `dataBucket` bekommt — Constitution III, geteilte Basis nicht duplizieren). Nach außen exponiert er **eine** API-Gateway-WebSocket-API, die Live- und Replay-Daten über denselben Socket liefert.

```
 Browser (apps/dashboard @ Vercel)
        │  wss://  (1 Verbindung, Live + Replay)
        ▼
┌──────────────────────────────────────────────┐
│  API Gateway WebSocket API  (F1-Realtime)     │
│  routes: $connect $disconnect subscribe       │
│          replay:start replay:stop             │
│  Lambda Request-Authorizer (Origin + Token)   │
└───┬───────────┬──────────────┬────────────────┘
    │           │              │
    ▼           ▼              ▼
 connect λ   subscribe λ    replay λ ──────► reads S3 raw/sessions/*.jsonl
 disconnect  (snapshot aus   (paced push,        (own clock, speed 1/2/4×,
 λ           F1Live DDB)      self-continuation)   self-reinvoke on cursor)
    │           │              │
    └─────┬─────┘              │ posts via @connections (ApiGwMgmt API)
          ▼                    ▼
   ┌──────────────┐     back to the one Browser connection
   │ Connections  │  (connectionId → session_id, TTL 2h)
   │ DDB table    │
   └──────▲───────┘
          │ lookup "who is subscribed to session X?"
          │
   ┌──────┴───────┐   DDB Stream (NEW_AND_OLD_IMAGES)
   │  fanout λ     │◄──────────── F1Live  (Phase 1)
   │  delta→clients│
   └──────────────┘
```

**Live-Pfad:** Consumer (Phase 1) schreibt nach `F1Live` → DDB-Stream → `fanout λ` baut ein `delta` und postet es an alle Connections, die diese `session_id` abonniert haben. **Snapshot-Pfad:** Beim `subscribe` liest `subscribe λ` den aktuellen Zustand der Session aus `F1Live` und schickt einen `snapshot` (Q-2: DDB für Live). **Replay-Pfad:** `replay λ` liest die archivierte `*.jsonl` aus S3 und streamt die Zeilen zeitgesteuert an genau diese Connection (R-2). Live und Replay benutzen dieselben Server-Message-Typen → das Frontend rendert beide gleich.

## Komponenten

### 1. WebSocket API (`RealtimeApi`)

- **Verantwortung:** Einziger Ingress fürs Frontend. Routen: `$connect`, `$disconnect`, `subscribe`, `replay:start`, `replay:stop`.
- **Runtime/Trigger:** API Gateway v2 WebSocket, Lambda-Proxy-Integration pro Route.
- **In/Out:** Client→Server `ClientMessage` (Zod, `@f1/shared`); Server→Client `ServerMessage` (Zod). Outbound via `ApiGatewayManagementApi.PostToConnection`.
- **Failure-Mode:** `PostToConnection` → `410 Gone` = tote Connection → aus Connections-Table löschen. Message > 128 KB → Snapshot chunken (`snapshot:part` n/of).

### 2. Lambda Request-Authorizer (`ConnectAuthorizer`)

- **Verantwortung:** Anti-Abuse für eine öffentliche Demo (Constitution VII). Prüft beim `$connect`: `Origin`-Header gegen Allowlist (Vercel-Prod + Preview-Wildcard) **und** ein kurzlebiges HMAC-Token aus dem Query-String.
- **Runtime/Trigger:** Lambda-Authorizer (REQUEST), nur an `$connect`.
- **In:** `$connect`-Request (Header + Query). **Out:** Allow/Deny-Policy.
- **Failure-Mode:** Kein/abgelaufenes Token oder fremder Origin → Deny (Connection kommt nicht zustande, keine Kosten). Token-Secret in SSM Parameter Store (Constitution VII), vom Next.js-Server-Route signiert.

### 3. Connect / Disconnect Lambdas

- **Verantwortung:** `connect λ` legt `connectionId`-Eintrag an (noch ohne Session). `disconnect λ` löscht ihn + markiert evtl. laufende Replay-Kette als abgebrochen.
- **In/Out:** Routen-Event → Connections-Table Put/Delete.
- **Failure-Mode:** Idempotent (Put/Delete by PK). Verwaiste Einträge fängt die TTL (2h).

### 4. Subscribe Lambda (`subscribe λ`)

- **Verantwortung:** `subscribe {session_id?}`. Fehlt `session_id`, resolved es die aktuell aktive Session aus `F1Live` (`meta`-Items, `isSessionActive`). Schreibt `connectionId → session_id` in die Connections-Table und schickt einen **Snapshot** des aktuellen DDB-Zustands (Positionen, Intervalle, Stints, Wetter).
- **In/Out:** `ClientMessage(subscribe)` → DDB-Query (`PK = session#<id>`) → `ServerMessage(snapshot)`.
- **Failure-Mode:** Keine aktive Session → `ServerMessage(info: "no-live-session")`, Frontend schlägt Replay vor. Snapshot zu groß → chunken (R-1).

### 5. Fanout Lambda (`fanout λ`)

- **Verantwortung:** DDB-Stream-Consumer. Übersetzt jedes `NEW_IMAGE` in ein `delta` (Entity-Typ aus SK ableiten via `@f1/shared`-Key-Parsing), bestimmt die `session_id` aus dem PK, schlägt alle abonnierten Connections nach und postet das `delta`.
- **Runtime/Trigger:** Lambda mit `DynamoEventSource` (BatchSize ~100, `bisectBatchOnError`, `reportBatchItemFailures`, max retry begrenzt — Stream-Records sind verderblich).
- **In/Out:** DDB-Stream-Batch → N× `PostToConnection`.
- **Failure-Mode:** `410` → Connection löschen, nicht den Batch failen. Throttle auf `@connections` → partieller Retry. Keine Subscriber → no-op (häufigster Fall, billig).

### 6. Replay Lambda (`replay λ`)

- **Verantwortung:** `replay:start {session_id, speed}` → liest `raw/sessions/<date>/<session>.jsonl` aus S3, spielt Zeilen nach `(fetched_at - t0)/speed` getaktet an **diese** Connection. Kann die 15-Min-Lambda-Wall überschreiten → **Self-Continuation**: pro Invocation wird ein Zeit-Chunk (Budget ~10 Min Wall) abgespielt, dann re-invoked sich die Lambda asynchron (`InvocationType: Event`) mit `{ connectionId, session_id, speed, cursor }`. `replay:stop` und Disconnect setzen ein Abbruch-Flag in der Connections-Table, das jeder Chunk vor dem nächsten Post prüft (R-3).
- **In/Out:** `ClientMessage(replay:start)` + S3-Objekt → getaktete `ServerMessage(delta)` + finales `replay:end`.
- **Failure-Mode:** Datei fehlt → `error("session-not-archived")`. Connection weg (`410`) → Kette stoppt sofort. Cursor in der re-invoke-Payload, nicht in S3 → keine zusätzliche Persistenz.

### 7. Connections Table (`F1Connections`)

- **Verantwortung:** Wer ist verbunden, was abonniert, läuft ein Replay.
- **Design:** eigene kleine `TableV2`, On-Demand, TTL — **nicht** in `F1Live` mischen (anderes Lifecycle, Constitution III sauber halten).

### 8. Frontend (`apps/dashboard`)

- **Verantwortung:** Next.js (App Router) auf Vercel. `useRaceSocket`-Hook hält die WS-Verbindung (Reconnect mit Backoff < 5s), Zustand-Store hält das normalisierte Renn-Modell, visx rendert.
- **Komponenten-Baum:** `RacePage` → `Dashboard` → `TimingTower` (Reihenfolge/Gap/Reifen je Fahrer), `GapChart` (visx — Rückstand-zum-Leader-Balken; T11-Entscheidung statt „Position über Runden", da der Store keine Per-Runden-Historie hält), `WeatherStrip`, `ReplayControls` (Toggle + 1×/2×/4×, T12), `ConnectionStatus`.
- **Failure-Mode:** Socket zu → Auto-Reconnect + Re-`subscribe` (stellt Snapshot wieder her, AC-4). Ungültige `ServerMessage` → verwerfen + `console.warn` (AC-6).

## Datenmodelle

### `packages/shared/src/ws-messages.ts` (neu — Single Source of Truth)

Zod-Schemas, von Infra-Lambdas **und** Frontend importiert.

```ts
// Client → Server
ClientMessage =
  | { action: "subscribe"; session_id?: string }
  | { action: "replay:start"; session_id: string; speed: 1 | 2 | 4 }
  | { action: "replay:stop" };

// Server → Client (Live + Replay identisch)
ServerMessage =
  | { type: "snapshot"; session_id: string; drivers: DriverState[]; weather: Weather | null; part?: { n: number; of: number } }
  | { type: "delta"; session_id: string; entity: "position" | "interval" | "lap" | "stint" | "weather"; data: unknown }
  | { type: "replay:end"; session_id: string }
  | { type: "info"; code: "no-live-session" | "session-not-archived" }
  | { type: "error"; message: string };
```

`DriverState` aggregiert die per-Fahrer-DDB-Items (Position, Gap, aktueller Stint/Reifen, letzte Runde) — abgeleitet aus den Phase-1-OpenF1-Schemas, kein neues Vokabular.

### DynamoDB `F1Connections`

- `PK = conn#<connectionId>`, `SK = meta`.
- Attribute: `session_id?`, `replayId?`, `aborted` (bool), `expiresAt` (TTL, `now + 2h`).
- PK/SK + TTL-Attribut über neue Helper in `@f1/shared/connections-keys.ts` (keine Magic Strings).
- Kein GSI: Fanout braucht „alle Connections für session X". Bei Demo-Volumen (≪ 100 gleichzeitig) reicht ein `Scan` mit `FilterExpression` je Fanout-Batch; GSI (`session_id`→connections) ist als Optimierung notiert, falls nötig.

### S3 (lesend, Phase-1-Layout)

- Replay liest `S3_PATHS.rawSession(date, sessionId)` aus `@f1/shared` — keine neuen Pfade.

### Frontend State

- **Zustand-Store** `useRaceStore`: `{ sessionId, drivers: Record<number, DriverState>, weather, mode: 'live'|'replay', connection }`. Push-basiert (Socket), daher Zustand statt React Query (Martins Konvention: React Query = pull-Server-State; hier ist es ein Stream).
- Initial-Snapshot kommt über den Socket (`subscribe`), nicht über REST.

## Externe Verträge

- **API Gateway Management API:** `PostToConnection`, Endpoint `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>`.
- **WebSocket-Message-Shapes:** `@f1/shared/ws-messages` (oben) — der Vertrag zwischen Browser und Backend.
- **Vercel-Env:** `NEXT_PUBLIC_WS_URL` (wss-Endpoint), serverseitig `WS_TOKEN_SECRET` (SSM-gespiegelt) zum Token-Signieren. Preview/Production getrennt.

## Security & IAM

Pro Lambda eigene Rolle, least privilege (Constitution VII):

- **fanout λ:** `dynamodb:DescribeStream/GetRecords/GetShardIterator/ListStreams` auf `F1Live`-Stream, `dynamodb:Scan/Query` auf `F1Connections`, `execute-api:ManageConnections` auf die WS-API-ARN, `dynamodb:DeleteItem` auf `F1Connections` (tote Connections).
- **subscribe λ:** `dynamodb:Query` auf `F1Live`, `dynamodb:PutItem` auf `F1Connections`, `execute-api:ManageConnections`.
- **replay λ:** `s3:GetObject` auf `raw/sessions/*`, `dynamodb:GetItem/UpdateItem` auf `F1Connections` (Abbruch-Flag), `execute-api:ManageConnections`, `lambda:InvokeFunction` auf sich selbst (Self-Continuation).
- **connect/disconnect λ:** `dynamodb:PutItem/DeleteItem` auf `F1Connections`.
- **authorizer λ:** `ssm:GetParameter` auf den Token-Secret-Pfad.
- **Secrets:** `WS_TOKEN_SECRET` in SSM Parameter Store (SecureString), nie im Bundle, nie in `.env` committen.

## Observability

Strukturierte JSON-Logs pro Lambda (Constitution VIII). Custom Metrics:

- `ActiveConnections` (Gauge, aus Connections-Table-Count).
- `FanoutPostLatency` (ms), `FanoutGoneConnections` (Count).
- `ReplayChunks` (Count, Dimension: session_id), `ReplayErrors` (Count).
- `AuthorizerDeny` (Count, Dimension: reason).

Alarme → bestehendes SNS-Topic `f1-alerts`:

- `Fanout-ErrorRate` > 5 % über 5 Min.
- `Replay-Failure` > 0 in 15 Min.
- `Authorizer-DenySpike` (möglicher Abuse / Fehlkonfiguration Token).

Dashboard `f1-pipeline` um eine Realtime-Reihe erweitern (Connections, Fanout-Latenz, Fanout-Errors) — kein zweites Dashboard.

## Kosten-Footprint

Annahme: 20 Renn-Wochenenden × ~6h aktive Sessions = 120h/Jahr Live; außerhalb gelegentliche Replays + Vercel-Idle.

| Service                        | Posten                                           | €/Jahr           |
| ------------------------------ | ------------------------------------------------ | ---------------- |
| API GW WebSocket — Messages    | ~432k delta-Posts/Live-Jahr × wenige Connections | ~0,80            |
| API GW WebSocket — Conn-Min    | wenige gleichzeitige Demo-Connections            | ~0,20            |
| Lambda (fanout)                | 1 Invoke/Stream-Batch, ARM64                     | ~0,40            |
| Lambda (replay/subscribe/auth) | sporadisch, durch Demo-Nutzung getrieben         | ~0,30            |
| DynamoDB `F1Connections`       | kleine Put/Delete/Scan-Last                      | ~0,20            |
| Vercel                         | Hobby-Tier (Portfolio)                           | 0 (Free)         |
| **Gesamt**                     |                                                  | **~1,90 €/Jahr** |

Steady State ohne Session/Connection ≈ 0 € (AC-8): keine offene Verbindung → keine Conn-Minuten, Fanout idle (kein Stream-Verkehr), Vercel statisch. Bleibt klar im 5-USD/Monat-Budget (Constitution IV).

## Test-Strategie

- **Unit (Vitest):** `ws-messages`-Schemas (happy + invalid), Connections-Key-Helper, `fanout`-Image→delta-Mapping (DI, kein AWS), `replay`-Pacing/Cursor-Logik (Fake Timers, gepinnter Clock), Authorizer-Token-Validierung.
- **Integration (pures Mocking, wie Phase 1 T12):** `fanout λ` gegen einen Mock-`PostToConnection` + In-Memory-Connections-Table mit echten `F1Live`-Stream-Record-Fixtures; `replay λ` gegen eine echte Fixture-JSONL (aus T3-Fixtures konstruierbar) — Assert: korrekte Reihenfolge + Speed-Skalierung + Stop bei `410`.
- **Frontend (Testing Library):** `useRaceSocket` (Reconnect-Backoff, Re-subscribe nach Drop), Replay-Toggle, Store-Reducer (delta → DriverState). Konvention: kritische Interaktionen, keine 100%-Jagd (Constitution X).
- **E2E (Playwright):** ein Smoke-Test — Seite öffnen → Connection → erste Daten sichtbar; Replay-Toggle → Frames laufen (gegen eine deployte Preview-URL).
- **Lighthouse:** CI-Step oder manuell auf der Preview, AC-7.

## Abweichungen von der Constitution

Keine. (WebSocket-Auth ist trotz öffentlicher Demo umgesetzt — Constitution VII; minimal, aber vorhanden.)
