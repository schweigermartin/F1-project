# Tasks: Live Dashboard

> **Plan:** [plan.md](./plan.md)
> **Status:** ready

Reihenfolge bewusst: Verträge → Backend-Stack → Live-Pfad → Replay → Security → Frontend → Deploy/Demo. Backend-Pfade (Live + Replay) müssen stehen, bevor das Frontend etwas anzuzeigen hat.

## Konventionen

- `[ ]` offen, `[~]` in Arbeit, `[x]` erledigt. Jeder Task = ein Commit (`feat(phase-2/TX): …`).
- Jeder Task hat **Output** (was existiert danach) + **Verify** (wie geprüft).
- Tasks mit `(parallel)` können parallel zum vorherigen laufen.

## Aufgaben

### T1 — WebSocket-Message-Schemas in `@f1/shared` — DONE

- **Output:**
  - `packages/shared/src/ws-messages.ts` — `ClientMessageSchema` (discriminated union über `action`: `subscribe`, `replay:start`, `replay:stop`) + `ServerMessageSchema` (discriminated union über `type`: `snapshot`, `delta`, `replay:end`, `info`, `error`) + `DriverStateSchema`/`DriverState` (per-Fahrer-View-Model, alle Felder außer `driver_number` nullable wegen partieller Live-Daten), wiederverwendet `TyreCompoundSchema`/`WeatherSchema` aus T2 (Constitution III). `ReplaySpeedSchema` = 1|2|4. `delta.data` bewusst `z.unknown()` (Frontend narrowt per `entity`, wie `PipelineEventSchema.payload`).
  - `packages/shared/src/connections-keys.ts` — `connPK` (`conn#<id>`), `connMetaSK`, 2h-TTL-Helper, eigene Attr-Konstanten (kein Mischen mit F1Live).
  - Beide via `src/index.ts` re-exportiert.
- **Verify:** 19 neue Vitest-Cases (happy + invalid je Variante, Discriminated-Union greift, lap-string-Gaps, null-Felder). `pnpm -F @f1/shared test` → **56 grün**, `pnpm typecheck` (alle Workspaces) grün, `pnpm format:check` grün.
- **Notes:** Single Source of Truth (Constitution III/VI) — Infra **und** Frontend importieren von hier.

### T2 — `RealtimeStack`-Skelett + Connections-Table — DONE

- **Output:**
  - `infra/lib/realtime-stack.ts` mit `RealtimeStackProps` (nimmt `liveTable: ITableV2` + `dataBucket: IBucket` als Cross-Stack-Refs, beide als `readonly` Felder für T3–T6 gehalten). `F1ConnectionsTable` als `TableV2`: PK/SK über `CONN_PK_ATTR`/`CONN_SK_ATTR` aus `@f1/shared` (Constitution III), On-Demand, TTL auf `expiresAt`, RemovalPolicy DESTROY (ephemer, TTL fängt Staleness). Kein eigener Stream.
  - `bin/app.ts`: `PipelineStack` jetzt an `const pipeline` gebunden, `RealtimeStack F1-Realtime` verdrahtet `pipeline.liveTable` + `dataLayer.dataBucket`. Phase=2-Tag am Stack.
- **Verify:** `cdk list` zeigt `F1-DataLayer` / `F1-Pipeline` / `F1-Realtime`. `cdk synth F1-Realtime` grün. 7 Assertion-Tests (PK/SK, Billing, TTL, Name, Removal, Table-Count, Phase-Tag) → **54 infra-Tests grün**. typecheck/lint/format grün.
- **Notes:** `liveTable` ist in `PipelineStack` bereits `readonly` exponiert (Stream-ARN für T5).

### T3 — WebSocket-API + Connect/Disconnect — DONE

- **Output:**
  - `WebSocketApi` (`F1-Realtime`, route-selection `$request.body.action`) + `WebSocketStage` `live` (auto-deploy) im `RealtimeStack`.
  - `infra/lambda/ws-connect/` + `infra/lambda/ws-disconnect/` (je `handler.ts` pure DI + `index.ts` mit `APIGatewayProxyWebsocketHandlerV2`). Connect PutItem't eine Connection-Row (conn#-PK, meta-SK, 2h-TTL); Disconnect DeleteItem't sie — die Löschung ist zugleich das Replay-Abbruch-Signal (T6 stoppt bei fehlender Row, R-3).
  - Least privilege (Constitution VII): Connect-Rolle nur `dynamodb:PutItem`, Disconnect-Rolle nur `dynamodb:DeleteItem` auf die `F1Connections`-ARN.
- **Verify:** 6 Handler-Unit-Tests (Item-Shape, TTL, single Put/Delete, DDB-Fehler-Propagation) + 4 Stack-Assertions (WEBSOCKET-API, `$connect`/`$disconnect`-Routen, auto-deploy-Stage, scoped IAM) → **64 infra-Tests grün**. `cdk synth F1-Realtime` + typecheck/lint/format grün.
- **Notes:** `$connect`-Authorizer kommt in T8; custom Routen (subscribe/replay) in T4/T6.

### T4 — Subscribe-Route + Snapshot aus DDB — DONE

- **Output:**
  - Route `subscribe` + `ws-subscribe λ` (`handler.ts` pure DI + `index.ts`).
  - `buildSnapshot(items)` faltet die flachen F1Live-Items (`{PK,SK,expiresAt,endpoint,...row}`) zu einer `DriverState` je Fahrer (Position/Gap/Interval + jeweils **letzter** Stint→Compound/Reifenalter und **letzte** Runde→Dauer) + Wetter, sortiert nach Position. `buildSnapshotMessages(...)` chunked auf `MAX_FRAME_BYTES` (120 KB, R-1) — Common Case = ein Frame ohne `part`, Wetter nur auf Frame 1.
  - `index.ts`: `resolveActiveSessionId` (Scan F1Live, Session mit jüngster TTL) wenn `session_id` fehlt, `setSubscription` (UpdateItem `session_id` auf der Conn-Row), `querySession` (Query `PK=session#<id>`), `post` via `ApiGatewayManagementApi.PostToConnection` (Endpoint aus `requestContext.domainName/stage`). Inbound via `SubscribeMessageSchema` validiert (Constitution VI) → `error`-Frame bei Müll. Kein aktive Session → `info:no-live-session`.
  - IAM: `liveTable.grantReadData`, `dynamodb:UpdateItem` auf Connections, `grantManageConnections`. Neue Dependency `@aws-sdk/client-apigatewaymanagementapi`.
- **Verify:** 11 Unit-Tests (Aggregation aus Fixture-Items: latest-stint/latest-lap/position/interval/weather-strip/no-driver-skip; Chunking 1-Frame vs. parted; explizite vs. resolvte Session; `no-live-session`-Fallback) + 2 Stack-Assertions (subscribe-Route, ManageConnections) → **76 infra-Tests grün**. `cdk synth` + typecheck/lint/format grün.

### T5 — Fanout-Lambda (DDB-Stream → delta) — DONE

- **Output:**
  - `skToEntity(sk)` in `@f1/shared/ddb-keys` — Inverse der SK-Builder (position/interval/lap/stint/weather, sonst null). 2 neue shared-Tests.
  - `ws-fanout λ` (`handler.ts` pure DI + `index.ts`). `imageToDelta(image)` → `{session_id (aus PK), message: delta{entity (aus SK via `skToEntity`+`DeltaEntitySchema`-Validierung), data (Row ohne PK/SK/expiresAt)}}`. `fanout(event)` gruppiert deltas pro Session (ein Connection-Lookup je Session/Batch), postet an alle Subscriber. `410 Gone` → Connection löschen + nächster Subscriber, **Batch nicht failen**; echter Fehler → rethrow (Stream-Retry). REMOVE/TTL-Records übersprungen.
  - `index.ts`: `unmarshall` der Stream-`NewImage`, `listConnections` (Scan `session_id`), `post` via `PostToConnection` (Endpoint = `webSocketStage.callbackUrl`), `deleteConnection`, `GoneException`/410-Mapping.
  - Stack: `DynamoEventSource` auf `liveTable`-Stream (LATEST, BatchSize 100, `bisectBatchOnError`, retry 3, `reportBatchItemFailures`); IAM `dynamodb:Scan`+`DeleteItem` auf Connections, `grantManageConnections`. Neue Dep `@aws-sdk/util-dynamodb`.
- **Verify:** 11 Handler-Tests (image→delta inkl. Attr-Stripping/weather/meta-null/Non-Session-PK; fan-out an N Connections, Lookup-once-per-Session, no-subscriber-no-op, REMOVE-skip, 410-delete-ohne-Batch-Fail, real-error-rethrow) + 2 Stack-Assertions (EventSourceMapping LATEST/100/ReportBatchItemFailures, scoped IAM) → **88 infra-Tests + 58 shared grün**. `cdk synth` + typecheck/lint/format grün.
- **Notes:** **Live-Pfad ist damit end-to-end** (Poller → … → DDB → Stream → Browser).

### T6 — Replay-Lambda (S3-JSONL → getakteter Stream) — DONE

- **Output:**
  - Routen `replay:start`/`replay:stop` (beide → `ws-replay λ`). `handler.ts` pure DI: `expandLines()` parst die archivierten PipelineEvent-Zeilen → flache, chronologisch sortierte `delta`-Timeline (Endpoint→Entity-Mapping). `handleReplay()` spielt ab `cursor` nach `(fetched_at − chunkStart)/speed`, Abbruch-Check alle 20 deltas, Self-Continuation bei Überschreiten des Wall-Budgets (10 min) via `scheduleContinuation(nextCursor)`, `replay:end` am Ende; `410`→`gone`, echter Fehler→rethrow.
  - `index.ts`: `replay:start` setzt `aborted=false`+frischen `replayId` und feuert **sofort** einen async Self-Invoke (cursor 0) — Wiedergabe läuft im Continuation-Pfad, nicht inline (umgeht den 29s-WS-Integration-Timeout, R-3). `replay:stop` setzt `aborted=true`. `isAborted` = Row fehlt ∨ `aborted` ∨ `replayId`-Mismatch (tötet verwaiste Ketten). `loadLines` listet `raw/sessions/` + matcht `/<session>.jsonl` (Datum steckt im Key), liest via `transformToString`.
  - Stack: 15-min-Timeout, `grantRead` + `s3:ListBucket` (raw/sessions/\*), `GetItem`+`UpdateItem` auf Connections, `grantManageConnections`, **self-`InvokeFunction`** (ARN via `formatArn` aus dem Funktionsnamen, **nicht** `functionArn`/GetAtt → sonst Dependency-Cycle). Neue Dep `@aws-sdk/client-lambda`.
- **Verify:** 11 Handler-Tests (expandLines sort/skip/entity-mapping; not-archived; full-play→replay:end; **Speed-Skalierung 1×/2×/4×** via gepinnter Clock; Cursor-Continuation bei Budget 0; Resume-ab-Cursor; Abort-Stop; 410-gone; real-error-rethrow) + 3 Stack-Assertions (replay:start/stop-Routen, S3-List+self-Invoke-IAM, 900s-Timeout) → **104 infra-Tests grün**. `cdk synth` + typecheck/lint/format grün.
- **Notes:** **Replay-Pfad steht** (Constitution V). Backend ist damit komplett — ab T9 Frontend.

### T7 — Wiring + IAM (least privilege) — DONE

- **Output:** Das Wiring (Routen, Stream-EventSource, scoped Grants) wurde bereits in T2–T6 mitgebaut; T7 verifiziert + verriegelt es. Review-Befund: **0 Wildcard-Resources** auf Hot-Path-Actions — alle 5 Lambdas haben getrennte Rollen mit scoped Policies (Connect PutItem, Disconnect DeleteItem, Subscribe read-F1Live+UpdateItem-Conn+ManageConnections, Fanout stream-read+Scan/Delete-Conn+ManageConnections, Replay GetObject/List-S3+GetItem/UpdateItem-Conn+ManageConnections+self-Invoke). Kein Nachschärfen nötig.
- **Verify:** 3 neue Guard-Tests: (1) kein Hot-Path-Action (`dynamodb:`/`s3:GetObject`/`s3:PutObject`/`execute-api:ManageConnections`/`lambda:InvokeFunction`) auf `Resource:"*"` (iteriert alle `AWS::IAM::Policy`), (2) genau die 5 `F1-WS-*`-Lambdas, (3) genau 5 WS-Routen (`$connect`/`$disconnect`/`subscribe`/`replay:start`/`replay:stop`). → **107 infra-Tests grün**. `cdk synth` + typecheck/lint/format grün.

### T8 — WebSocket-Auth (Authorizer + Token) — DONE

- **Output:**
  - `@f1/shared/ws-token.ts` (separater Subpath via `exports`-Map, **nicht** aus `index.ts` re-exportiert → `node:crypto` bleibt aus dem Browser-Bundle): `signWsToken`/`mintWsToken` (HMAC-SHA256 `<exp>.<sig>`, 60s TTL) + `verifyWsToken` (timing-safe, Gründe malformed/bad-signature/expired). Geteilter Vertrag für Authorizer **und** den Next.js-Signier-Endpoint (T9).
  - `ws-authorizer λ` (`handler.ts` pure DI + `index.ts`): `authorizeConnect` prüft Origin-Allowlist (exakt oder `*.suffix`) **vor** dem Token (`verifyWsToken`). `index.ts` liest das Secret aus SSM (WithDecryption, warm-cached), liefert die IAM-Policy-Antwort (WS-Authorizer brauchen Policy-Shape, nicht `isAuthorized`).
  - Stack: `WebSocketLambdaAuthorizer` (REQUEST, identitySource `route.request.querystring.token`) an `$connect`. `ssm:GetParameter` nur auf `/f1/ws-token-secret`. `allowedOrigins`-Prop. Neue Dep `@aws-sdk/client-ssm`.
- **Verify:** 5 Token-Tests in shared (mint/verify, expired, falsches Secret, manipuliertes exp, malformed) + 6 Authorizer-Handler-Tests (Origin exakt/Wildcard/Look-alike/missing; allow; Deny-Origin-vor-Token; missing/expired Token) + 2 Stack-Assertions (REQUEST-Authorizer auf `$connect` CUSTOM, scoped SSM-Grant) → **115 infra + 63 shared grün**. `cdk synth` + typecheck (alle 4 Workspaces) + lint/format grün. esbuild bündelt den `@f1/shared/ws-token`-Subpath sauber.
- **Notes:** Das Secret wird **out-of-band** angelegt (nie im Template, Constitution VII): `aws ssm put-parameter --name /f1/ws-token-secret --type SecureString --value <random>` — gehört in den T14-Deploy-Runbook. **Backend Phase 2 ist damit komplett — ab T9 Frontend.**

### T9 — Frontend-Scaffold (`apps/dashboard`) — DONE

- **Output:**
  - Next.js 16 (App Router, React 19) ersetzt den Stub (`src/index.ts` entfernt). `next.config.mjs` mit `transpilePackages: ["@f1/shared"]` (shared ist TS-Source) + `reactStrictMode`. `src/app/{layout.tsx,page.tsx,globals.css}` — `RacePage`-Placeholder (Socket-Hook T10, visx T11, Replay-UI T12).
  - `src/app/api/ws-token/route.ts` — server-seitiger Route-Handler signiert via `@f1/shared/ws-token` (`mintWsToken`), liefert `{token, wsUrl}`, `force-dynamic` (60s-TTL, nie gecacht). `node:crypto` bleibt server-only.
  - Reale Scripts: `dev`/`build`/`start`/`typecheck`/`test` (`vitest --passWithNoTests`); `lint` delegiert ans Root-eslint (wie infra/shared). `.env.example` (`NEXT_PUBLIC_WS_URL` + server-only `WS_TOKEN_SECRET`). tsconfig um Next-Includes + Plugin erweitert. `next-env.d.ts` gitignored (generiert, importiert `.next/types`).
- **Verify:** `pnpm -F @f1/dashboard build` grün (3 Routen: `/`, `/_not-found`, `ƒ /api/ws-token`). typecheck (alle 4 Workspaces) + Root-`pnpm lint` + `format:check` grün. Sauberer typecheck ohne `.next`/`next-env.d.ts` bestätigt → CI-tauglich.
- **Notes:** Vercel-Projekt + Env-Wiring ist Deploy-Zeit (T14).

### T10 — `useRaceSocket` + Zustand-Store — DONE

- **Output:**
  - `src/store/race-store.ts` (Zustand): normalisiertes `{sessionId, mode, connection, drivers, weather, noLiveSession}`. `applySnapshot` (merged Fahrer → unterstützt gechunkte Frames), `applyDelta` (Weather-Slot vs. per-Fahrer-Patch), pure `applyEntity` (Position/Interval + monotone Stint/Lap-Updates).
  - `src/lib/race-socket.ts` — DI-fähiger Controller (kein DOM): Token holen → Connect → `subscribe`/`replay`-Intent auf `open` (re-)senden, jede Frame via `ServerMessageSchema` validieren (Invalid → drop+report, AC-6), Reconnect mit **gedeckeltem Exp-Backoff (250ms→3s, immer < 5s, AC-4)** + Re-Subscribe.
  - `src/hooks/use-race-socket.ts` (`'use client'`) — verdrahtet Controller (echtes `fetch`/`WebSocket`-Adapter) an den Store, mappt Message-Typen, gibt `startReplay`/`stopReplay` für T12.
- **Verify:** 13 Vitest-Tests ohne DOM (Fake-WebSocket + injizierter Timer): Store (snapshot/merge/delta/weather/no-driver-skip, monotone stint/lap) + Controller (Connect+Token-URL+subscribe-on-open, valid-vs-invalid-Frame AC-6, Reconnect+Re-Subscribe < 5s AC-4, Backoff-Wachstum 250→3000-cap, kein Reconnect nach `close()`). `pnpm -F @f1/dashboard test`/`typecheck`/`build` + Root-`lint`/`format` grün.
- **Notes:** Kern-Logik bewusst DOM-frei getestet (Controller-DI + pure Store) → kein Testing-Library/jsdom-Setup nötig; der Hook ist der dünne Wrapper.

### T11 — visx-Visualisierungen

- **Output:** `TimingTower` (Reihenfolge/Gap/Reifen/letzte Runde je Fahrer), `PositionChart` (visx, Position über Runden), `WeatherStrip`, `ConnectionStatus`. Responsives Layout.
- **Verify:** Lokal gegen einen Mock-Socket (gespeicherte Snapshot+delta-Sequenz aus Fixtures) — Tower aktualisiert ohne Refresh, Reihenfolge stimmt. Komponenten < 200 Zeilen (Martins Konvention).

### T12 — Replay-UI

- **Output:** `ReplayControls`: Toggle Live↔Replay, Session-Auswahl (archivierte Sessions), Speed 1×/2×/4×, sendet `replay:start`/`replay:stop`. „No live session" → schlägt Replay vor (AC-2/US-3).
- **Verify:** Gegen deployte Backend-Preview: Replay einer archivierten Session läuft chronologisch + speed-skaliert (AC-5).

### T13 — Observability (Realtime)

- **Output:** Custom Metrics (`ActiveConnections`, `FanoutPostLatency`, `FanoutGoneConnections`, `ReplayChunks`, `ReplayErrors`, `AuthorizerDeny`). Alarme `Fanout-ErrorRate`, `Replay-Failure`, `Authorizer-DenySpike` → SNS `f1-alerts`. Dashboard `f1-pipeline` um Realtime-Widgets erweitert.
- **Verify:** `cdk synth` grün, Alarme im Template, melden an bestehendes Topic.

### T14 — Deploy (AWS + Vercel)

- **Output:** `cdk deploy F1-Realtime` erfolgreich, WS-Endpoint live. Frontend auf Vercel deployed (Prod-URL). Env in beiden Vercel-Environments gesetzt.
- **Verify:** Prod-URL öffnet, verbindet, zeigt entweder Live-Daten (während Session) oder bietet Replay an. Reconnect-Test: DevTools-Offline → < 5s Recovery (AC-4). Lighthouse Desktop ≥ 90 / Mobile ≥ 80 (AC-7).

### T15 — Playwright-Smoke-E2E

- **Output:** Ein E2E-Test gegen die Preview-URL: Seite öffnen → Connection hergestellt → erste Daten/Replay-Frame sichtbar (Constitution X). In CI als optionaler Job (preview-getriggert).
- **Verify:** Test grün gegen Preview-Deploy.

### T16 — Demo-Check / Phase-2-Abschluss

- **Output:** Live-URL + Screenshot im README, Architektur-Diagramm aktualisiert (WS-Pfad jetzt ✅), Phasen-Tabelle `Live Dashboard → ✅`. Spec-/Plan-Status → `done`. `git tag phase-2-done`.
- **Verify:** Recruiter-Test (Constitution II/XII): jemand öffnet README + URL und versteht in 2 Min, was das Dashboard zeigt — ohne mündliche Erklärung. Replay funktioniert mit mindestens einer archivierten Session.
