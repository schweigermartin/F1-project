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

### T2 — `RealtimeStack`-Skelett + Connections-Table

- **Output:** `infra/lib/realtime-stack.ts` mit `RealtimeStackProps` (nimmt `liveTable: ITableV2` + `dataBucket: IBucket` als Cross-Stack-Refs). `F1Connections`-`TableV2` (On-Demand, TTL, PK/SK aus `@f1/shared`). `bin/app.ts` verdrahtet `pipeline.liveTable` + `dataLayer.dataBucket` → `realtime`. Phase=2-Tag.
- **Verify:** `cdk synth` grün, `cdk list` zeigt `F1-Realtime`. Assertion-Test: Table-Count, TTL, Billing, Tag.
- **Notes:** `liveTable` muss aus `PipelineStack` als `readonly` exportiert/übergeben werden (Stream-ARN für T5).

### T3 — WebSocket-API + Connect/Disconnect

- **Output:** API-Gateway-v2-WebSocket-API mit Routen `$connect`/`$disconnect`. `connect λ`/`disconnect λ` (`handler.ts` pure DI + `index.ts`): Put/Delete in `F1Connections`. Disconnect setzt Abbruch-Flag für laufende Replays.
- **Verify:** Unit-Tests (Put/Delete idempotent, Abbruch-Flag). Assertion-Test: Routen existieren, Integrationen verdrahtet.

### T4 — Subscribe-Route + Snapshot aus DDB

- **Output:** Route `subscribe`. `subscribe λ`: resolved aktive Session (`F1Live` `meta` + `isSessionActive`) wenn `session_id` fehlt, schreibt `connectionId → session_id`, baut `snapshot` (Fahrer-Aggregat + Wetter) aus DDB-Query und postet ihn (gechunkt wenn > 128 KB). `no-live-session`-`info` als Fallback.
- **Verify:** Unit — Snapshot-Aggregation aus Fixture-DDB-Items, Chunking-Grenze, Fallback ohne aktive Session. Mock-`PostToConnection`.

### T5 — Fanout-Lambda (DDB-Stream → delta)

- **Output:** `fanout λ` (`handler.ts` pure DI): Stream-`NEW_IMAGE` → `delta` (Entity aus SK via `@f1/shared`-Parsing), `session_id` aus PK, Subscriber-Lookup, `PostToConnection`. `410 Gone` → Connection löschen, Batch nicht failen. `DynamoEventSource` auf `F1Live`-Stream (BatchSize 100, `reportBatchItemFailures`, begrenzte Retries).
- **Verify:** Integrationstest (pures Mocking, wie Phase-1-T12): echte `F1Live`-Stream-Record-Fixtures → korrekte deltas an die richtigen Mock-Connections, `410`-Handling, keine-Subscriber-no-op. Assertion-Test: EventSource verdrahtet.

### T6 — Replay-Lambda (S3-JSONL → getakteter Stream)

- **Output:** Routen `replay:start`/`replay:stop`. `replay λ` (`handler.ts` pure DI): liest `S3_PATHS.rawSession(...)`, spielt Zeilen nach `(fetched_at - t0)/speed`, Self-Continuation via async self-`Invoke` mit `cursor`, Abbruch-Check (Disconnect/`replay:stop`/`410`) vor jedem Post, `replay:end` am Ende.
- **Verify:** Unit mit Fake Timers + gepinnter Clock — Reihenfolge chronologisch, Speed-Skalierung 1×/2×/4×, Cursor-Übergabe, Stop bei Abbruch-Flag, fehlende Datei → `session-not-archived`. Fixture-JSONL aus T3-Daten.

### T7 — Wiring + IAM (least privilege)

- **Output:** Alle Lambdas als `NodejsFunction` (ESM/ARM64, `@aws-sdk/*` extern). Route-Integrationen, Stream-EventSource, `execute-api:ManageConnections` je posting-Lambda auf die WS-API-ARN, S3-`GetObject` (replay), DDB-Grants scoped, replay-self-`InvokeFunction`. Keine `*`-Policies (Constitution VII).
- **Verify:** `cdk synth` grün, alle Realtime-Assertion-Tests grün, IAM-Policies im Template scoped (Test prüft keine Wildcard-Resource auf den heißen Pfaden).

### T8 — WebSocket-Auth (Authorizer + Token)

- **Output:** `ConnectAuthorizer λ` (REQUEST) an `$connect`: Origin-Allowlist + HMAC-Token-Check, Secret aus SSM. Next.js-Route-Handler `/api/ws-token` signiert kurzlebige Tokens. `WS_TOKEN_SECRET` in SSM (SecureString), in Vercel-Env gespiegelt.
- **Verify:** Unit — gültiges/abgelaufenes/fehlendes Token, fremder Origin → Deny. Manuell: Connect ohne Token wird abgelehnt.

### T9 — Frontend-Scaffold (`apps/dashboard`)

- **Output:** Echte Next.js-App (App Router, TS) ersetzt den Stub. Reale `build`/`lint`/`typecheck`/`test`-Scripts (ESLint-React-Block greift bereits). Vercel-Projekt + `NEXT_PUBLIC_WS_URL`/Token-Env (Preview/Prod getrennt). Leere `RacePage`.
- **Verify:** `pnpm -F @f1/dashboard build` + `typecheck` grün, lokaler `next dev` lädt, Root-`pnpm lint` bleibt grün.

### T10 — `useRaceSocket` + Zustand-Store

- **Output:** `useRaceSocket`-Hook (Connect mit Token, Reconnect-Backoff < 5s, Re-`subscribe` nach Drop, `ServerMessage`-Zod-Validierung) + `useRaceStore` (Zustand): `snapshot`/`delta` → normalisiertes `drivers`-Modell, `mode` live/replay.
- **Verify:** Testing-Library/Vitest — Reconnect nach simuliertem Drop, ungültige Message verworfen (AC-6), delta-Reducer korrekt. (AC-4)

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
