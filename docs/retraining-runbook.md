# Runbook: Re-Training & Modell-Roll-out (Phase 5, AC-4/AC-5)

Re-Training ist **bewusst manuell** (Spec 005 R-1): das Roll-out-Gate ist eine
menschliche Entscheidung, und ein Training dauert lokal < 10 Minuten — eine
Step-Functions-Pipeline wäre mehr Infra als Nutzen. Dieser Pfad wurde in
Phase 6 (0.1.0 → 0.2.0) genau so durchlaufen.

## Wann re-trainieren?

- Der Saison-Chart (Predictor-Frontend bzw. `f1-inference`-Dashboard, Zeile
  "Model quality per race") zeigt eine anhaltend fallende Hit-Rate / steigenden
  Brier Score, **oder**
- genug neue Rennen sind aufgelaufen (Faustregel: ~½ Saison), dass der
  Trainingsdatensatz spürbar wächst.

## Ablauf (alle Schritte lokal, AWS-Profil `private`)

1. **Backfill aktualisieren** — neue Rennen in die Trainingsdaten holen:

   ```bash
   cd ml && uv run python scripts/backfill_practice.py   # inkrementell, cache-gestützt, Rate-Limit-Backoff
   ```

2. **Trainieren** — `ml/notebooks/train_podium_model.ipynb` mit neuer
   Ziel-Version `<semver>` (Minor-Bump bei neuen Features, Patch bei reinem
   Daten-Refresh) komplett durchlaufen lassen. Fixer Seed + gepinnte
   Datenversion (Constitution IX: Re-Run ⇒ gleicher Score).

3. **Roll-out-Gate** — das Eval-Kapitel des Notebooks vergleicht die neue
   Version mit der aktiven auf demselben zeitlichen Test-Split. Gate: ROC-AUC
   **und** Log-Loss besser, sonst kein Roll-out (Ergebnis trotzdem in der
   Model-Card dokumentieren).

4. **Publishen** — das Notebook lädt `models/<semver>/{model.json,history.csv,model_card.md}`
   nach S3 (Pfade aus `f1pred.layout`/`S3_PATHS`, nie handgebaut). Die alte
   Version bleibt unangetastet als Fallback — nie `latest/`.

5. **Version-Flip** — der einzige Code-Schritt, eine reviewbare Zeile:
   `ACTIVE_MODEL_VERSION` in `infra/lib/pipeline-stack.ts` auf `<semver>`
   setzen. Das ist der explizite "Pointer" auf das aktive Modell (Spec 005
   D-5): Schedule-Sync stempelt die Version in jede Inference-Schedule.

   ```bash
   AWS_PROFILE=private pnpm -F @f1/infra cdk deploy F1-Pipeline
   ```

6. **Smoke-Check** — nach dem nächsten Schedule-Sync-Lauf (04:00 UTC, oder
   manuell invoken) trägt die nächste `f1-infer-*`-Schedule die neue Version;
   nach dem Pre-Race-Lauf zeigt das Predictor-Frontend das neue
   Modell-Badge. Rollback = Konstante zurückflippen + erneut deployen.

## Manueller Evaluation-Re-Run (Phase 5)

Wenn eine Race-Evaluation fehlt (Alarm `F1-Evaluation-Errors` oder
`F1-Archiver-NotifyFailures`), lässt sie sich idempotent nachholen — die λ
akzeptiert das nackte Event-Detail:

```bash
AWS_PROFILE=private aws lambda invoke --function-name F1-Evaluation \
  --cli-binary-format raw-in-base64-out \
  --payload '{"date":"2026-06-07","session_id":"<openf1 session_key des Rennens>"}' /dev/stdout
```

Der `session_key` steht im S3-Archiv-Pfad (`raw/sessions/<date>/<session_key>.jsonl`).
Re-Runs überschreiben dieselben DDB-Keys deterministisch (kein Duplikat).
Genauso lassen sich bereits archivierte Rennen **backfillen**, die vor dem
Phase-5-Deploy liefen.

## Skizze: so würde man es automatisieren (bewusst nicht gebaut)

Step Functions, getriggert von der Evaluation-λ (z. B. Hit-Rate-Schwellwert
über N Rennen): Fargate-Task (Training > 15-min-Lambda-Limit) führt Backfill +
Training headless aus, schreibt `models/<semver>/` + Eval-Report nach S3, und
endet in einem manuellen Approval-Step (SNS), der den Version-Flip per
parametrisiertem Deploy auslöst. Kosten/Nutzen für ~24 Rennen pro Jahr:
negativ — daher Runbook statt Pipeline (Constitution IV).
