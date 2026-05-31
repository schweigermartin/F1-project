/**
 * Static model behind the /architecture showcase page. Kept data-driven (nodes +
 * edges + copy) so the SVG diagram and the legend render from one source and the
 * graph integrity is unit-testable (see architecture-data.test.ts).
 *
 * Coordinates live in a 980×470 SVG viewBox. Node anchor = top-left corner.
 */

export const DIAGRAM = { width: 980, height: 470, nodeW: 132, nodeH: 54 } as const;

/** Visual grouping → colour. Mirrors the README phase legend. */
export type NodeGroup = "source" | "ingest" | "persist" | "push" | "frontend";

export const GROUP_COLOR: Record<NodeGroup, string> = {
  source: "#5a6473",
  ingest: "#e10600", // F1 red — the event-driven ingest path
  persist: "#2d6cdf",
  push: "#1f9d57",
  frontend: "#8a5cf6",
};

export const GROUP_LABEL: Record<NodeGroup, string> = {
  source: "Quelle",
  ingest: "Ingest (event-driven)",
  persist: "Persistenz",
  push: "Echtzeit-Push",
  frontend: "Frontend",
};

export interface PipelineNode {
  id: string;
  label: string;
  sub: string;
  group: NodeGroup;
  x: number;
  y: number;
  /** Shown in the detail panel on hover/focus. */
  detail: string;
}

export interface PipelineEdge {
  from: string;
  to: string;
  label?: string;
  /** Travel time of the flow dot in seconds — slower = lower-frequency hop. */
  dur: number;
}

export const NODES: PipelineNode[] = [
  {
    id: "schedule",
    label: "Schedule-Sync λ",
    sub: "cron 04:00 UTC",
    group: "ingest",
    x: 190,
    y: 24,
    detail:
      "Liest täglich OpenF1 /sessions und programmiert pro kommender Session ein aws-scheduler-Schedule mit Fenster [start−15min, end+30min]. So pollt nichts 24/7.",
  },
  {
    id: "openf1",
    label: "OpenF1 API",
    sub: "REST",
    group: "source",
    x: 20,
    y: 150,
    detail:
      "Öffentliche F1-Timing-API. Liefert Positionen, Intervalle, Runden, Stints und Wetter pro Session.",
  },
  {
    id: "poller",
    label: "Poller λ",
    sub: "5 s, nur Session",
    group: "ingest",
    x: 200,
    y: 150,
    detail:
      "Pollt OpenF1 alle 5 s — aber nur während einer Session (vom Schedule getriggert). Validiert jede Antwort mit dem Zod-Schema des Endpoints (Validation #1) und legt sie als PipelineEvent in SQS.",
  },
  {
    id: "sqs",
    label: "SQS + DLQ",
    sub: "F1-Events",
    group: "ingest",
    x: 372,
    y: 150,
    detail:
      "Entkoppelt Poller und Consumer. Nachrichten tragen ein schema_version-Literal — ein Teil-Deploy verwirft veraltete Nachrichten, statt sie falsch zu lesen. Fehler landen in der Dead-Letter-Queue.",
  },
  {
    id: "consumer",
    label: "Consumer λ",
    sub: "Validation ×2",
    group: "ingest",
    x: 544,
    y: 150,
    detail:
      "Re-validiert jede Nachricht (Validation #2, Constitution VI) und schreibt sie nach DynamoDB (Hot-Cache) und S3 (durable). Schema-Drift schlägt laut fehl, nie still.",
  },
  {
    id: "ddb",
    label: "DynamoDB",
    sub: "F1Live · TTL · Stream",
    group: "persist",
    x: 780,
    y: 70,
    detail:
      "Single-Table-Design. Live-Zeilen bekommen 24 h TTL (Hot-Cache); Keys kommen aus @f1/shared (nie hand-gebaut). DynamoDB Streams triggern den Echtzeit-Push.",
  },
  {
    id: "s3",
    label: "S3",
    sub: "raw archive",
    group: "persist",
    x: 780,
    y: 200,
    detail:
      "Durable Copy aller Events unter raw/sessions/. RETAIN — ein Stack-Destroy löscht das Archiv nie. Quelle fürs ML-Training (Phase 3) und für den Replay.",
  },
  {
    id: "archiver",
    label: "Archiver λ",
    sub: "15 min → .jsonl",
    group: "persist",
    x: 560,
    y: 290,
    detail:
      "Konsolidiert die vielen kleinen S3-Parts alle 15 min zu einer .jsonl pro Session — günstiger zu lesen, ideal als Trainings- und Replay-Quelle.",
  },
  {
    id: "websocket",
    label: "WebSocket API",
    sub: "API GW + HMAC-Auth",
    group: "push",
    x: 780,
    y: 340,
    detail:
      "API-Gateway-WebSocket. $connect prüft Origin-Allowlist + kurzlebiges HMAC-Token. Eine Fanout-λ am DynamoDB-Stream pusht Deltas an alle subscribten Clients.",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    sub: "Next.js · Vercel",
    group: "frontend",
    x: 540,
    y: 340,
    detail:
      "Diese App. Rendert Timing-Tower, Gap-Chart und Wetter aus dem WebSocket-Store (Zustand). Live und Replay laufen über denselben Socket.",
  },
];

export const EDGES: PipelineEdge[] = [
  { from: "schedule", to: "poller", label: "programmiert", dur: 3.2 },
  { from: "openf1", to: "poller", label: "poll 5 s", dur: 1.1 },
  { from: "poller", to: "sqs", dur: 1.0 },
  { from: "sqs", to: "consumer", dur: 1.0 },
  { from: "consumer", to: "ddb", label: "write", dur: 1.2 },
  { from: "consumer", to: "s3", label: "raw parts", dur: 1.4 },
  { from: "s3", to: "archiver", label: "consolidate", dur: 2.4 },
  { from: "ddb", to: "websocket", label: "Stream", dur: 1.3 },
  { from: "websocket", to: "dashboard", label: "delta push", dur: 0.9 },
];

// ─── ML model section ──────────────────────────────────────────────────────

/**
 * The 6 pre-race features the podium classifier consumes, in the exact order of
 * ml/src/f1pred/schema.py FEATURE_NAMES. `importance` is the mean |SHAP| share —
 * ILLUSTRATIVE ordering until the Phase-3 artifact is published; replace with the
 * real model_card numbers then (see isModelPlaceholder).
 */
export interface ModelFeature {
  name: string;
  label: string;
  importance: number;
}

export const MODEL_FEATURES: ModelFeature[] = [
  { name: "grid_position", label: "Startplatz", importance: 0.34 },
  { name: "quali_gap_to_pole_s", label: "Quali-Rückstand zur Pole (s)", importance: 0.22 },
  { name: "constructor_form", label: "Team-Form", importance: 0.16 },
  { name: "driver_form", label: "Fahrer-Form", importance: 0.14 },
  { name: "track_history", label: "Strecken-Historie", importance: 0.1 },
  { name: "is_wet", label: "Regen", importance: 0.04 },
];

/** True until the real Phase-3 metrics/SHAP are wired in — drives a "illustrativ" badge. */
export const isModelPlaceholder = true;

export interface MetricRow {
  label: string;
  model: number;
  baseline: number;
  fmt: "pct" | "num";
}

/** Model vs. the grid-top-3 baseline. ILLUSTRATIVE until Phase-3 publish. */
export const MODEL_METRICS: MetricRow[] = [
  { label: "Accuracy", model: 0.86, baseline: 0.82, fmt: "pct" },
  { label: "ROC-AUC", model: 0.91, baseline: 0.78, fmt: "num" },
  { label: "Log-Loss", model: 0.34, baseline: 0.45, fmt: "num" },
];

// ─── Tech stack section ──────────────────────────────────────────────────────

export interface TechItem {
  name: string;
  why: string;
}

export interface TechCategory {
  title: string;
  accent: string;
  items: TechItem[];
}

export const TECH_STACK: TechCategory[] = [
  {
    title: "Infrastruktur (IaC)",
    accent: GROUP_COLOR.ingest,
    items: [
      { name: "AWS CDK v2 (TypeScript)", why: "Infra als typisierter Code, 3 Stacks, CI-synth." },
      {
        name: "Lambda · SQS · DynamoDB · S3",
        why: "Event-driven, serverless, kostet im Leerlauf ~0.",
      },
      { name: "EventBridge Scheduler", why: "Pollt nur während Sessions statt 24/7." },
    ],
  },
  {
    title: "Echtzeit & Frontend",
    accent: GROUP_COLOR.frontend,
    items: [
      { name: "API Gateway WebSocket", why: "Push statt Polling; HMAC-Token + Origin-Gate." },
      { name: "Next.js 16 + React 19", why: "App Router, deployed auf Vercel." },
      { name: "visx + Zustand", why: "SVG-Charts ohne Bloat; schlanker Client-State." },
    ],
  },
  {
    title: "Machine Learning",
    accent: GROUP_COLOR.persist,
    items: [
      { name: "XGBoost", why: "Gradient-Boosting für den Podium-Classifier." },
      { name: "FastF1", why: "Historische Renndaten (Quali, Ergebnisse, Wetter)." },
      { name: "SHAP", why: "Erklärbarkeit — welches Feature treibt die Vorhersage." },
    ],
  },
  {
    title: "Qualität & Betrieb",
    accent: GROUP_COLOR.push,
    items: [
      { name: "GitHub Actions CI", why: "Lint, Typecheck, Tests, cdk synth — grün auf main." },
      { name: "Zod (doppelte Validierung)", why: "Schema-Drift schlägt laut fehl, nie still." },
      { name: "CloudWatch Alarme + Budget", why: "Jeder Lambda überwacht; 5-USD-Budget-Alarm." },
    ],
  },
];
