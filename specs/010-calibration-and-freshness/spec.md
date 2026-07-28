# Spec: Kalibrierung & Aktualität — ehrliche Wahrscheinlichkeiten, frische Formkurven

> **Phase:** 010
> **Status:** draft
> **Owner:** Martin
> **Constitution:** II (jede Phase liefert Vorzeigbares), III (geteilte Basis), IV (Kostenkontrolle), V (Demo muss jederzeit funktionieren), VI (Zod an allen Grenzen), IX (Modell-Artefakte versioniert + Model Card), X (pragmatische Tests), XII (README aktuell).

## Problem / Motivation

Am 2026-07-28 wurde das deployte System gegen die Realität gemessen. Drei
unabhängige Befunde, jeder einzeln belegt:

**(1) Die ausgegebenen Wahrscheinlichkeiten sind mathematisch unmöglich.** Es
gibt drei Podiumsplätze, die Summe aller Fahrerwahrscheinlichkeiten eines
Rennens muss also 3,00 sein. Gemessen über die Read-API
(`?race_date=…&round=…`, alle 19 Fahrer summiert):

| Runde | Σ P(Podium) | Fahrer > 50 % |
| ----- | ----------- | ------------- |
| 8 Österreich | **5,83** | 6 |
| 9 Silverstone | **5,27** | 6 |
| 10 Spa | **4,94** | 5 |
| 11 Ungarn | **5,57** | 6 |

Das ist kein Ausreißer, sondern strukturell: `PredictionItemSchema`
(`packages/shared/src/prediction-schema.ts:61-68`) bewertet jeden Fahrer als
unabhängiges Binärproblem; `predict_podium` (`ml/src/f1pred/inference.py:142`)
nimmt `predict_proba(...)[:, 1]` je Zeile. Nichts im System kennt die
Nebenbedingung „es gibt genau drei Plätze". Zusätzlich ist das Modell mit
`scale_pos_weight` (`ml/src/f1pred/train.py:57`) bewusst gegen die
Klassen-Imbalance gewichtet — das verbessert das Ranking und verschiebt die
Wahrscheinlichkeiten systematisch nach oben. Ein 91-%-Balken in der UI bedeutet
heute **nicht** 91 %.

**(2) Das Modell rechnet mit Formkurven aus 2025.** Das deployte Artefakt
`s3://f1-data-…/models/0.2.0/history.csv` enthält 1838 Zeilen mit den Jahren
2022, 2023, 2024, 2025 — letzte Zeile `2025,24,COL,…,Abu Dhabi Grand Prix,…`.
Das Trainingsfenster ist in `ml/notebooks/train_podium_model.ipynb:92-93`
fixiert (`FIRST_YEAR = 2022`, `train ≤2023, val 2024, test 2025`), und das
History-Artefakt wird pro Modellversion mitgeliefert
(`ml/src/f1pred/inference_handler.py:78-80`: _„version selects the history
artifact bundled with the model"_). `build_race_features`
(`ml/src/f1pred/inference.py:263`) hängt nur das Zielrennen an genau diese
History an.

Konsequenz: `driver_form` und `constructor_form` sind der Punkteschnitt der
letzten fünf Rennen **von 2025** (`ROLLING_WINDOW = 5`,
`ml/src/f1pred/features.py`), `track_history` der Schnitt 2022–2025. Für jedes
Rennen 2026 sind diese drei der zwölf Features eingefroren und aktualisieren
sich über die Saison nie. 2026 ist zugleich die größte Regeländerung der
F1-Geschichte (768 statt 800 kg, 20 cm kürzerer Radstand, 50/50-Hybrid, kein
DRS, aktive Aerodynamik) — die Formkurve aus 2025 beschreibt eine Hackordnung,
die es nicht mehr gibt. Nichts in der UI legt das offen.

**(3) Gegen die triviale Baseline steht es unentschieden.** Modell-Top-3 gegen
tatsächliches Podium, vier Rennen (Read-API vs. Jolpica):

| Runde | Modell | Realität | Treffer | Startaufstellung 1-2-3 | Treffer |
| ----- | ------ | -------- | ------- | ---------------------- | ------- |
| 8 | VER LEC NOR | RUS VER ANT | 1 | RUS ANT PIA | 2 |
| 9 | LEC ANT RUS | LEC RUS HAM | 2 | ANT LEC HAD | 1 |
| 10 | VER ANT NOR | ANT LEC VER | 2 | ANT VER NOR | 2 |
| 11 | NOR ANT HAM | NOR VER ANT | 2 | NOR LEC VER | 2 |
| | | | **7/12** | | **7/12** |

**Vorbehalt, der überall mitgeführt werden muss: n = 4 Rennen / 12 Slots. Das
ist statistisch nicht signifikant** und beweist nicht, dass das Modell wertlos
ist. Aber es ist der erste Vergleich, den ein technischer Betrachter zieht, und
er existiert bisher nirgends in der UI — obwohl `evaluate.baseline_grid_top3`
(`ml/src/f1pred/evaluate.py:59`) ihn im Training längst berechnet.

## Ziel

Die angezeigte Zahl bedeutet, was sie sagt — und wo das System schwach ist,
sagt es das selbst, statt es zu kaschieren.

Ein Portfolio-Projekt, das seine eigene Baseline zeigt und seine
Trainings-Grenzen offenlegt, ist glaubwürdiger als eines mit 94-%-Balken ohne
Kontext. Diese Phase ist deshalb bewusst zuerst Ehrlichkeit, dann Modellgüte.

## User Stories

- **US-1 (ehrliche Wahrscheinlichkeit):** Als Fan sehe ich Podiumswahrscheinlichkeiten, die sich über alle Fahrer eines Rennens zu drei Plätzen aufaddieren — ein 60-%-Balken heißt, dass dieser Fahrer in 6 von 10 Fällen aufs Podium fährt.
- **US-2 (rückwirkend korrekt):** Als Fan gelten die korrigierten Wahrscheinlichkeiten auch für alle bereits gespeicherten Rennen der Saison, ohne dass Vorhersagen neu berechnet werden müssen.
- **US-3 (Baseline sichtbar):** Als Betrachter sehe ich bei jedem Rennen direkt nebeneinander, wie gut das Modell und wie gut die triviale Startaufstellungs-Baseline getroffen haben — inklusive des Hinweises, wie klein die Stichprobe ist.
- **US-4 (Grenzen offengelegt):** Als Betrachter erfahre ich an der Vorhersage selbst, auf welchen Saisons das Modell trainiert wurde und dass die Formkurven-Features aus der Vorsaison stammen.
- **US-5 (Formkurven nachziehbar):** Als Betreiber kann ich mit einem Befehl die gefahrenen Rennen der laufenden Saison an das History-Artefakt anhängen und hochladen, sodass die nächste Vorhersage mit aktueller Form rechnet.

## Acceptance Criteria

- **AC-1:** Für jedes Rennen mit ≥ 4 Fahrern summieren sich die von der Read-API gelieferten normalisierten Wahrscheinlichkeiten auf 3,00 (± 0,01).
- **AC-2:** Die Normalisierung ist streng monoton — die Reihenfolge der Fahrer nach Wahrscheinlichkeit ist vor und nach der Normalisierung identisch.
- **AC-3:** Jede normalisierte Wahrscheinlichkeit liegt in [0, 1].
- **AC-4:** Die Normalisierung wird auf dem Lesepfad angewendet, nicht beim Schreiben: alle bereits in DynamoDB liegenden Vorhersagen (Runden 1–11) liefern ohne Backfill korrigierte Werte. Die rohe Modellausgabe bleibt unverändert gespeichert.
- **AC-5:** Ein Frontend-Deploy und ein Lambda-Deploy können in beliebiger Reihenfolge erfolgen, ohne dass die Seite bricht (neues Feld ist optional; Frontend fällt auf den Rohwert zurück).
- **AC-6:** Die Vorhersage-Karte nennt Trainingsfenster und Herkunft der Formkurven-Features sichtbar, ohne Klick.
- **AC-7:** Für ein gefahrenes Rennen zeigt die UI Modell-Trefferquote und Grid-Baseline-Trefferquote nebeneinander, jeweils als „x von 3", plus den Stichprobenvorbehalt.
- **AC-8:** Die Baseline-Anzeige verursacht keinen zusätzlichen Netzwerk-Aufruf — sie nutzt ausschließlich die bereits auf der Seite geladenen Daten (Grid, Vorhersage, Ergebnis).
- **AC-9:** `refresh_history` hängt gefahrene Rennen an ein bestehendes History-Frame an, ist idempotent (zweimal ausgeführt = gleiches Ergebnis) und lässt die Sortierung nach (year, round) intakt.
- **AC-10:** Ein History-Frame, das über das Trainingsfenster hinausreicht, führt zu identischem Verhalten der Feature-Erzeugung — die `.shift(1)`-Garantie (kein Leakage) bleibt nachweislich erhalten.
- **AC-11:** Alle bestehenden Tests bleiben grün; die neuen Kernfunktionen (Normalisierung, History-Append, Baseline-Vergleich) haben eigene Tests inklusive Randfälle.

## Out of Scope

Bewusst **nicht** Teil dieser Phase — jeweils mit Begründung:

- **Neu-Training auf 2026-Daten (Modell 0.3.0).** Braucht eine gefahrene Saison als Validierungsfold und einen Gate-Lauf; diese Phase schafft nur die Voraussetzung (frische History + ehrliche Metriken). Folgephase.
- **Echte Kalibrierung (Platt / Isotonic / Beta) auf einem Holdout-Fold.** Setzt das Neu-Training voraus. Die hier gebaute Normalisierung ist eine rangerhaltende Umskalierung auf die bekannte Nebenbedingung „drei Plätze", keine gelernte Kalibrierung — und wird auch genau so benannt.
- **Multi-Head-Modell** (Sieg / Punkte / DNF, vollständige Reihenfolge). Eigene Phase.
- **Saisonweite Baseline-Kurve** im `SeasonPerformance`-Chart. Bräuchte die Startaufstellung je Rennen; die liegt weder im Evaluations-Record (`packages/shared/src/evaluation-schema.ts:59-71`) noch in den Prediction-Rows. Erst wenn die Evaluation die Grid-Baseline mitschreibt — eigene Aufgabe.
- **Automatischer History-Refresh als Lambda.** FastF1 in der Inferenz-Lambda ist genau der Grund, warum die History vorberechnet wird (Rate-Limit). Diese Phase macht aus dem Runbook einen reproduzierbaren Befehl; die Automatisierung folgt separat.
- Ungenutzte OpenF1-Endpunkte (`pit`, `race_control`, `car_data`, …) und Reifendegradation — eigener Strang.

## Kosten (Constitution IV)

**0 €/Monat zusätzlich.** Kein neuer AWS-Dienst, keine neue Lambda, kein
zusätzlicher Aufruf: Die Normalisierung ist reine Rechenarbeit im bestehenden
Read-API-Lambda (< 1 ms bei 20 Fahrern), die Baseline nutzt bereits geladene
Daten (AC-8), der History-Refresh läuft lokal. Der einzige Schreibzugriff ist
ein `PutObject` auf ein paar hundert kB.
