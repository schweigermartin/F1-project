# OpenF1 API — Spike Notes (Phase 1 T1)

> Empirisch ermittelt am **2026-05-30**. OpenF1 ist eine Community-API, kann sich ändern — falls etwas später nicht stimmt, hier nachjustieren und im Commit beziffern, was sich verschoben hat.

## TL;DR für die Pipeline

- **Basis-URL:** `https://api.openf1.org/v1`
- **Auth:** keine (public).
- **Rate-Limit:** ~**4 Requests/Sekunde**, danach `HTTP 429` mit `Retry-After: 1`.
- **Endpoints, die wir nutzen:** `/sessions`, `/position` (singular!), `/intervals`, `/laps`, `/stints`, `/weather`.
- **"Session aktiv?"** = `now()` liegt zwischen `date_start` und `date_end` der Session UND `is_cancelled == false`. Sonst nichts pollen.
- **Cost-Folge fürs Polling-Design:** Tick alle 5s × 5 Endpoints = 1 RPS — komfortabel unter dem Limit. `weather` reicht alle 6 Ticks (30s) wie im Plan vorgesehen.

## Endpoint-Übersicht

| Endpoint         | Method | Query-Params                   | Response-Shape              | Anmerkung                                                                 |
| ---------------- | ------ | ------------------------------ | --------------------------- | ------------------------------------------------------------------------- |
| `GET /sessions`  | GET    | `year`, `session_key`, …       | Array von Session-Objekten  | Quelle für Scheduling                                                     |
| `GET /position`  | GET    | `session_key`, `driver_number` | Array (Snapshots über Zeit) | **Singular** — `/positions` gibt 404 mit `{"detail":"No results found."}` |
| `GET /intervals` | GET    | `session_key`                  | Array                       | Gap-to-leader + interval                                                  |
| `GET /laps`      | GET    | `session_key`                  | Array                       | Rundenzeiten + Sector-Segments + Speeds                                   |
| `GET /stints`    | GET    | `session_key`                  | Array                       | Reifen-Stints (compound + Start/End-Lap)                                  |
| `GET /weather`   | GET    | `session_key`                  | Array                       | Pressure, humidity, wind, temperatures                                    |

## Sample Responses

### `/sessions?year=2026` (Auszug)

```json
{
  "session_key": 11291,
  "session_type": "Race",
  "session_name": "Race",
  "date_start": "2026-05-24T20:00:00+00:00",
  "date_end": "2026-05-24T22:00:00+00:00",
  "meeting_key": 1285,
  "circuit_key": 23,
  "circuit_short_name": "Montreal",
  "country_key": 46,
  "country_code": "CAN",
  "country_name": "Canada",
  "location": "Montréal",
  "gmt_offset": "-04:00:00",
  "year": 2026,
  "is_cancelled": false
}
```

### `/position?session_key=11291&driver_number=63`

```json
{
  "date": "2026-05-24T19:07:20.910000+00:00",
  "session_key": 11291,
  "meeting_key": 1285,
  "position": 1,
  "driver_number": 63
}
```

- Eine Zeile = ein Positions-Snapshot zu einem Zeitpunkt.
- Filter `driver_number` ist optional aber empfohlen — sonst kommen sehr viele Rows.
- Für ein 2h-Rennen mit 20 Fahrern: ~33 Zeilen pro Fahrer = ~660 Zeilen total. Überschaubar.

### `/intervals?session_key=11291`

```json
{
  "date": "2026-05-24T19:07:54.848000+00:00",
  "session_key": 11291,
  "driver_number": 63,
  "meeting_key": 1285,
  "gap_to_leader": 0.0,
  "interval": 0.0
}
```

- `gap_to_leader` = Sekunden zum Führenden (oder Runden-Lücken als String `+1 LAP`).
- `interval` = Sekunden zum Vordermann.
- 22.5k Rows für ein einzelnes Rennen — am Stream-Ende hat das Volumen.

### `/laps?session_key=11291`

```json
{
  "meeting_key": 1285,
  "session_key": 11291,
  "driver_number": 41,
  "lap_number": 1,
  "date_start": "2026-05-24T20:09:47.754000+00:00",
  "duration_sector_1": null,
  "duration_sector_2": null,
  "duration_sector_3": null,
  "i1_speed": null,
  "i2_speed": null,
  "is_pit_out_lap": false,
  "lap_duration": null,
  "segments_sector_1": [2048, 2048, 2048, 2048, 2048, 2048],
  "segments_sector_2": [2048, 2048, 2048, 2048, 2048, 2048]
}
```

- **Wichtig:** viele Felder sind in der ersten Runde `null` (z.B. `lap_duration` weil sie noch läuft). Schema muss das tolerieren — `z.number().nullable()`, nicht `z.number()`.
- `segments_sector_*` sind Mini-Sektor-Codes (Mini-Sectors). `2048` ≈ "neutral/keine Daten".
- **In T3 nachträglich entdeckt:** `segments_sector_*` enthält **`null`-Einträge IM Array** (nicht nur als ganzer Wert). Schema muss `z.array(z.number().int().nullable())` sein, sonst fliegen Live-Laps raus. Genau dafür war der Fixture-Validation-Test gut.

### `/stints?session_key=11291`

```json
{
  "meeting_key": 1285,
  "session_key": 11291,
  "stint_number": 1,
  "driver_number": 41,
  "lap_start": 1,
  "lap_end": 1,
  "compound": "MEDIUM",
  "tyre_age_at_start": 0
}
```

- Stints werden live verlängert (`lap_end` wächst), bis ein Boxenstopp einen neuen Stint öffnet.
- `compound`: `SOFT` / `MEDIUM` / `HARD` / `INTERMEDIATE` / `WET` (evtl. mehr).

### `/weather?session_key=11291`

```json
{
  "date": "2026-05-24T19:07:46.504000+00:00",
  "session_key": 11291,
  "pressure": 1025.5,
  "humidity": 74.4,
  "wind_direction": 185,
  "air_temperature": 12.4,
  "meeting_key": 1285,
  "track_temperature": 17.2,
  "wind_speed": 5.7,
  "rainfall": 0
}
```

- 1 Reading pro Minute (160 Rows für 2h Rennen).
- `rainfall` ist ein Indikator (0 = trocken, sonst Intensität).

## Rate-Limit — empirisch

12 schnelle Requests an `/sessions` hintereinander:

```
call 1:  HTTP 200,  109ms
call 2:  HTTP 200,   77ms
call 3:  HTTP 200,   79ms
call 4:  HTTP 200,  276ms
call 5:  HTTP 429,   92ms  retry-after: 1
call 6:  HTTP 429,   82ms  retry-after: 1
call 7:  HTTP 429,   76ms  retry-after: 1
call 8:  HTTP 429,   77ms  retry-after: 1
call 9:  HTTP 429,  172ms  retry-after: 1
call 10: HTTP 200,   87ms
call 11: HTTP 200,   86ms
call 12: HTTP 200,   79ms
```

- **Token-Bucket-Verhalten:** ~4 Tokens regen sich pro Sekunde. Burst von 4 möglich, dann sofort 429 mit `Retry-After: 1`. Nach 1 Sekunde wieder frei.
- **Keine** `X-RateLimit-*`-Header — nur `Retry-After`.
- **Folge für Phase 1 T7 (Poller-Lambda):**
  - Pro Tick: 5 Endpoints sequenziell oder parallel — bei Parallel-Fetch alle 5 in ~150ms durch, das ist ein Burst von 5 = grenzwertig. **Empfehlung:** sequenziell mit `await`. Latenz bei 5 × 100ms = 500ms — passt locker in 5s-Tick.
  - 429 ist erwartetes Verhalten → exponential backoff (max 2 Retries) im Poller, dann Tick skippen. Nicht in DLQ schreiben.

## "Session aktiv" — Detektor

```ts
function isSessionActive(session: Session, now = new Date()): boolean {
  if (session.is_cancelled) return false;
  const start = new Date(session.date_start);
  const end = new Date(session.date_end);
  return now >= start && now <= end;
}
```

Für das EventBridge-Scheduling (Plan §2 `scheduleSync` Lambda):

- Täglich um 04:00 UTC `/sessions?year=<currentYear>` ziehen (~120 KB, harmlos).
- Sessions in den nächsten 48h filtern.
- Pro Session: Schedule-Window = `date_start - 15min` bis `date_end + 30min`.
- Practice startet meist eine Stunde vor `date_start`, manchmal früher — der 15-Min-Puffer ist eher knapp. **TBD:** auf 30 Min Vorlauf erhöhen, sobald wir einen Live-Test-Lauf hatten und sehen wie früh die ersten Datenzeilen kommen.

## Stolperfallen / Notizen für Folge-Tasks

1. **Endpoint-Namen sind inkonsistent**: `/position` (singular) vs. `/intervals|laps|stints|weather` (plural) vs. `/sessions` (plural). Vermutlich historisch gewachsen — Zod-Schemas und HTTP-Client-Helper müssen das berücksichtigen.
2. **Null-Toleranz:** Live-Daten haben viele `null`-Felder, bevor sie "fertig" sind (Rundenzeiten, Sektor-Splits, Speeds). Zod-Schemas konsequent `nullable()`.
3. **Zeitstempel:** `date` und `date_*` sind ISO-8601 mit `+00:00`-Suffix. `z.string().datetime()` akzeptiert das.
4. **`session_key` und `meeting_key`:** beide globally unique Integer. Wir nutzen `session_key` als primärer Bezug, weil er für die Datenflüsse die Granularität ist (Practice 1, Practice 2, Quali, Race haben jeweils eigene `session_key`s im selben `meeting_key`).
5. **Keine offiziellen API-Versionierung** sichtbar — wenn Felder sich ändern, fällt das uns über die Zod-Validierung auf die Füße. Genau dafür haben wir DLQ + `SchemaValidationFailure`-Metric vorgesehen.
6. **Reifen-Compound-Strings:** alle UPPERCASE. Falls Bedrock-Prompts oder Frontend das anders erwarten, im Consumer einmal normalisieren.

## Was wir aus diesem Spike NICHT haben

- Echtes Verhalten während einer Live-Session (Latenz vom Track bis API, Update-Frequenz, Datengrößen). → Wird in **T15** beim ersten Live-Free-Practice gemessen.
- Verhalten bei Session-Abbruch (red flag, SC, VSC) — relevant für die Archiver-"Session-Ende"-Detektion (30 Min ohne neue Events). → In T9 zu prüfen.
- Wie OpenF1 mit Schema-Änderungen umgeht (gibt es Deprecation-Header? eine Changelog-URL?). → Lange Beobachtungszeit, nicht jetzt entscheidbar.

## Fixture-Quelle

Alle Beispiele oben stammen aus Session **`11291` (Montréal Race 2026-05-24)**. Diese Session wird in T3 (`ml/scripts/fetch_fixtures.py`) als Snapshot persistiert, damit Unit- und Integrationstests deterministisch laufen können.
