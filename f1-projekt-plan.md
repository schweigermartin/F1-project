# F1 Software-Projekt — Umsetzungsplan

**Ziel:** Portfolio-Stück, das zwei zusammenhängende Systeme zeigt — ein Live Telemetry Dashboard (Infra-Skills) und einen Race Outcome Predictor (ML-Skills) — verbunden über eine gemeinsame Datenpipeline.

**Rahmen:** Wenige Stunden pro Woche. Deshalb in abgeschlossene Phasen geschnitten: nach jeder Phase existiert etwas Vorzeigbares, auch wenn danach pausiert wird.

**Leitprinzip:** Parallel im Ergebnis, sequenziell im Bauen. Beide Projekte teilen sich S3 als Datenlayer. Das wird zuerst gebaut und nie doppelt gemacht.

---

## Phase 0 — Fundament (gemeinsame Basis)

Das Setup, das beide Projekte brauchen. Einmal machen, nie wieder anfassen.

- Monorepo anlegen (passt zu deinem pnpm-Workflow): `apps/dashboard`, `apps/predictor`, `infra/`, `packages/shared`.
- AWS-Account vorbereiten: IAM-User mit minimalen Rechten, AWS CLI lokal, Budget-Alarm auf kleinem Betrag (z.B. 5 €) als Schutz.
- IaC-Tool wählen: AWS CDK (TypeScript) — passt zu deinem Stack und hält Infra im selben Repo.
- S3-Bucket als zentraler Datenlayer anlegen. Layout festlegen: `raw/sessions/<datum>/<session-id>.json` für Live-Archiv, `models/<version>/model.json` für ML-Artefakte.
- README mit Architektur-Diagramm (die beiden Diagramme aus dem Chat).

**Vorzeigbar danach:** Repo-Struktur + Infra-Code + dokumentierte Architektur. Schon das ist Portfolio-Material.

**Aufwand:** 1 Session.

---

## Phase 1 — Datenpipeline (Backbone von Projekt 2)

Der event-driven Ingest-Loop. Das technisch interessanteste Stück und gleichzeitig der Datenlieferant für den Predictor.

- OpenF1 API erkunden: relevante Endpoints (positions, intervals, laps, stints, weather) testen, Datenformate verstehen.
- Poller-Lambda (TypeScript): pollt OpenF1, schreibt Roh-Events in SQS. Per EventBridge-Rule getriggert (5s-Intervall, nur während aktiver Sessions).
- SQS-Queue als Buffer (schützt vor Ratelimits + Spikes), inkl. Dead-Letter-Queue.
- Consumer-Lambda: liest aus SQS, schreibt Live-State in DynamoDB (mit TTL 24h) und archiviert nach S3.
- DynamoDB Single-Table-Design: `PK=session#<id>`, `SK=driver#<num>#<ts>`, TTL-Attribut.
- CloudWatch: Basis-Alarm "Feed abgerissen" (keine Messages in X Minuten).

**Vorzeigbar danach:** Funktionierende Pipeline, die echte F1-Daten sammelt und archiviert. Demonstriert SQS, Lambda, DynamoDB, S3, EventBridge, CloudWatch.

**Aufwand:** 2-3 Sessions. Größter Brocken — bewusst zuerst, weil beide Projekte darauf aufbauen.

---

## Phase 2 — Live Dashboard Frontend (schließt Projekt 2 ab)

Die Visualisierung der gesammelten Daten.

- API Gateway mit WebSocket-Route. DynamoDB Streams triggern Push an verbundene Clients.
- React-App (`apps/dashboard`): WebSocket-Hook, Live-Charts mit Recharts oder visx (Gaps, Sektorzeiten, Reifen-Stints).
- State-Management mit Zustand oder React Query.
- Deployment auf Vercel.
- Fallback-Modus: wenn keine Live-Session läuft, archivierte Session aus S3 abspielen (wichtig fürs Portfolio — Demo muss jederzeit funktionieren, nicht nur an Renn-Wochenenden).

**Vorzeigbar danach:** Komplettes Projekt 2. Live-URL, die du in jede Bewerbung packen kannst.

**Aufwand:** 2-3 Sessions.

---

## Phase 3 — ML-Modell (Kern von Projekt 1)

Jetzt erst der ML-Teil, weil die Trainingsdaten (S3-Archiv + FastF1) jetzt verfügbar sind.

- FastF1 lokal: historische Daten ziehen, Features bauen (Quali-Pace-Delta, Startposition, Strecken-Historie des Fahrers, Reifenstrategie, Wetter, Constructor-Form).
- XGBoost- oder LightGBM-Classifier trainieren (Ziel: Podium-Wahrscheinlichkeit pro Fahrer). Strukturierte Tabellendaten — Gradient Boosting schlägt hier jedes LLM.
- Modell evaluieren (Accuracy, Log-Loss, Kalibrierung), SHAP für Feature-Wichtigkeit.
- Modell-Artefakt nach S3 (`models/<version>/`).

**Vorzeigbar danach:** Trainiertes, evaluiertes Modell mit Notebook, das den Prozess dokumentiert. ML-Portfolio-Stück für sich.

**Aufwand:** 2-3 Sessions.

---

## Phase 4 — Inferenz + Bedrock (schließt Projekt 1 ab)

Modell in Produktion bringen und die Erklärungsschicht draufsetzen.

- Inference-Lambda (Python): lädt Modell aus S3, berechnet Wahrscheinlichkeiten.
- Bedrock-Integration: SHAP-Top-Features als strukturierter Prompt rein, natürlichsprachliche Begründung raus ("Verstappen 68% Podium, weil ..."). Bedrock erklärt, sagt nicht vorher.
- Vorhersagen + Begründungen in DynamoDB.
- React-Frontend (`apps/predictor`): Wahrscheinlichkeits-Balken pro Fahrer + ausklappbare Bedrock-Erklärung. Auf Vercel deployen.

**Vorzeigbar danach:** Komplettes Projekt 1. Zweite Live-URL.

**Aufwand:** 2 Sessions.

---

## Phase 5 — Der Loop (verbindet beide Projekte)

Der Schritt, der aus zwei Projekten ein System macht — und der erfahrungsgemäß im Interview am meisten Eindruck macht.

- Nach jedem Rennen: Vorhersage vs. tatsächliches Ergebnis vergleichen (beide schon in DynamoDB).
- Trefferquote des Modells berechnen und im Frontend anzeigen.
- Optional: Live-Daten aus dem S3-Archiv ins nächste Training einfließen lassen — Modell wird über die Saison besser.

**Vorzeigbar danach:** Ein selbstverbesserndes System mit messbarer Performance. Die Story fürs Portfolio.

**Aufwand:** 1-2 Sessions.

---

## Kostenkontrolle (durchgehend)

- Polling nur während aktiver Sessions (EventBridge-Rule per Lambda an/aus).
- DynamoDB On-Demand statt Provisioned für ein Lernprojekt.
- Bedrock-Aufrufe cachen / nur bei neuer Vorhersage.
- Budget-Alarm aus Phase 0 als Sicherheitsnetz.

## Reihenfolge-Logik

1. **Phase 0+1 zuerst** — gemeinsame Basis, nicht verhandelbar.
2. **Phase 2 vor Phase 3** — schließt ein Projekt komplett ab, gibt früh eine Live-Demo und Motivation.
3. **Phase 3+4** — ML-Teil, profitiert von den schon gesammelten Daten.
4. **Phase 5** — Krönung, verbindet alles.

Wenn die Zeit zwischendurch ausgeht, hast du nach Phase 2 bereits ein vollständiges, vorzeigbares Projekt. Nach Phase 4 zwei. Nach Phase 5 ein zusammenhängendes System.
