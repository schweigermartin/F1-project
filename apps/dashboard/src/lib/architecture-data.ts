/**
 * Static model behind the /architecture showcase page. Kept data-driven (nodes +
 * edges + copy) so the SVG diagram and the legend render from one source and the
 * graph integrity is unit-testable (see architecture-geometry.test.ts).
 *
 * Coordinates live in a 980×470 SVG viewBox. Node anchor = top-left corner.
 */

export const DIAGRAM = { width: 980, height: 470, nodeW: 144, nodeH: 56 } as const;

/** Visual grouping → colour. Mirrors the README phase legend. */
export type NodeGroup = "source" | "ingest" | "persist" | "push" | "frontend";

export const GROUP_COLOR: Record<NodeGroup, string> = {
  source: "#7c8696",
  ingest: "#e10600", // F1 red — the event-driven ingest path
  persist: "#3b82f6",
  push: "#22c55e",
  frontend: "#a855f7",
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
  /** Emoji glyph shown inside the node. */
  icon: string;
  /** Plain-language one-liner (the headline of the detail panel). */
  plain: string;
  /** The technical detail shown under the plain line. */
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
    sub: "cron · 04:00 UTC",
    group: "ingest",
    icon: "⏰",
    x: 188,
    y: 22,
    plain: "Plant täglich im Voraus, wann welche Session läuft — damit nur dann gepollt wird.",
    detail:
      "Liest täglich OpenF1 /sessions und programmiert pro kommender Session ein aws-scheduler-Schedule mit Fenster [start−15min, end+30min]. So läuft nichts 24/7.",
  },
  {
    id: "openf1",
    label: "OpenF1 API",
    sub: "REST · extern",
    group: "source",
    icon: "🏁",
    x: 20,
    y: 150,
    plain: "Die öffentliche Datenquelle: Positionen, Zeiten und Wetter live aus der Box.",
    detail:
      "Öffentliche F1-Timing-API. Liefert Positionen, Intervalle, Runden, Stints und Wetter pro Session.",
  },
  {
    id: "poller",
    label: "Poller λ",
    sub: "alle 5 s · nur Session",
    group: "ingest",
    icon: "📡",
    x: 198,
    y: 150,
    plain: "Fragt während der Session alle 5 Sekunden die neuesten Daten ab.",
    detail:
      "Pollt OpenF1 alle 5 s — aber nur während einer Session (vom Schedule getriggert). Validiert jede Antwort mit dem Zod-Schema des Endpoints (Validation #1) und legt sie als PipelineEvent in SQS.",
  },
  {
    id: "sqs",
    label: "SQS + DLQ",
    sub: "Queue · Puffer",
    group: "ingest",
    icon: "📨",
    x: 374,
    y: 150,
    plain: "Eine Warteschlange als Puffer — entkoppelt Abholen und Verarbeiten.",
    detail:
      "Entkoppelt Poller und Consumer. Nachrichten tragen ein schema_version-Literal — ein Teil-Deploy verwirft veraltete Nachrichten, statt sie falsch zu lesen. Fehler landen in der Dead-Letter-Queue.",
  },
  {
    id: "consumer",
    label: "Consumer λ",
    sub: "Validierung ×2",
    group: "ingest",
    icon: "⚙️",
    x: 550,
    y: 150,
    plain: "Prüft jede Nachricht und legt sie in die Datenbank und ins Archiv.",
    detail:
      "Re-validiert jede Nachricht (Validation #2, Constitution VI) und schreibt sie nach DynamoDB (Hot-Cache) und S3 (durable). Schema-Drift schlägt laut fehl, nie still.",
  },
  {
    id: "ddb",
    label: "DynamoDB",
    sub: "F1Live · TTL · Stream",
    group: "persist",
    icon: "🗄️",
    x: 778,
    y: 66,
    plain: "Schneller Zwischenspeicher für den aktuellen Renn-Stand.",
    detail:
      "Single-Table-Design. Live-Zeilen bekommen 24 h TTL (Hot-Cache); Keys kommen aus @f1/shared (nie hand-gebaut). DynamoDB Streams triggern den Echtzeit-Push.",
  },
  {
    id: "s3",
    label: "S3",
    sub: "raw archive · durable",
    group: "persist",
    icon: "🪣",
    x: 778,
    y: 198,
    plain: "Das dauerhafte Archiv — jede Rohnachricht bleibt erhalten.",
    detail:
      "Durable Copy aller Events unter raw/sessions/. RETAIN — ein Stack-Destroy löscht das Archiv nie. Quelle fürs ML-Training (Phase 3) und für den Replay.",
  },
  {
    id: "archiver",
    label: "Archiver λ",
    sub: "15 min → .jsonl",
    group: "persist",
    icon: "📦",
    x: 560,
    y: 266,
    plain: "Räumt die vielen kleinen Dateien regelmäßig zu einer großen zusammen.",
    detail:
      "Konsolidiert die vielen kleinen S3-Parts alle 15 min zu einer .jsonl pro Session — günstiger zu lesen, ideal als Trainings- und Replay-Quelle.",
  },
  {
    id: "websocket",
    label: "WebSocket API",
    sub: "API GW · HMAC-Auth",
    group: "push",
    icon: "🔌",
    x: 778,
    y: 340,
    plain: "Schiebt jede Änderung sofort an alle offenen Browser — kein Nachladen.",
    detail:
      "API-Gateway-WebSocket. $connect prüft Origin-Allowlist + kurzlebiges HMAC-Token. Eine Fanout-λ am DynamoDB-Stream pusht Deltas an alle subscribten Clients.",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    sub: "Next.js · Vercel",
    group: "frontend",
    icon: "📊",
    x: 536,
    y: 340,
    plain: "Was du siehst: Tabelle, Abstände und Wetter — live im Browser.",
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

/** Headline numbers for the hero strip. */
export interface Stat {
  value: string;
  label: string;
}

export const STATS: Stat[] = [
  { value: "2", label: "Systeme" },
  { value: "3", label: "AWS-Stacks" },
  { value: "10", label: "Lambdas" },
  { value: "~1 €", label: "pro Monat" },
  { value: "100 %", label: "als Code (IaC)" },
];

// ─── ML model section ──────────────────────────────────────────────────────

/**
 * The 6 pre-race features the podium classifier consumes. `importance` is the
 * mean |SHAP| share — ILLUSTRATIVE ordering until the Phase-3 artifact is
 * published; replace with the real model_card numbers then (see isModelPlaceholder).
 * Names map exactly to ml/src/f1pred/schema.py FEATURE_NAMES.
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

/** True until the real Phase-3 metrics/SHAP are wired in — drives an "illustrativ" badge. */
export const isModelPlaceholder = true;

export interface MetricRow {
  label: string;
  model: number;
  baseline: number;
  fmt: "pct" | "num";
  /** Plain-language gloss of what the metric means. */
  hint: string;
}

/** Model vs. the grid-top-3 baseline. ILLUSTRATIVE until Phase-3 publish. */
export const MODEL_METRICS: MetricRow[] = [
  { label: "Accuracy", model: 0.86, baseline: 0.82, fmt: "pct", hint: "Wie oft richtig" },
  { label: "ROC-AUC", model: 0.91, baseline: 0.78, fmt: "num", hint: "Trennschärfe (1 = perfekt)" },
  {
    label: "Log-Loss",
    model: 0.34,
    baseline: 0.45,
    fmt: "num",
    hint: "Strafe für Fehlsicherheit ↓",
  },
];

/** One illustrative prediction, to make the abstract concrete. */
export const MODEL_EXAMPLE = {
  driver: "Startplatz 2",
  context: "+0,12 s zur Pole · trocken · starke Team-Form",
  probability: 0.68,
};

// ─── Tech stack section ──────────────────────────────────────────────────────

export interface TechItem {
  name: string;
  why: string;
}

export interface TechCategory {
  title: string;
  icon: string;
  accent: string;
  items: TechItem[];
}

export const TECH_STACK: TechCategory[] = [
  {
    title: "Infrastruktur (IaC)",
    icon: "🏗️",
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
    icon: "⚡",
    accent: GROUP_COLOR.frontend,
    items: [
      { name: "API Gateway WebSocket", why: "Push statt Polling; HMAC-Token + Origin-Gate." },
      { name: "Next.js 16 + React 19", why: "App Router, deployed auf Vercel." },
      { name: "visx + Zustand", why: "SVG-Charts ohne Bloat; schlanker Client-State." },
    ],
  },
  {
    title: "Machine Learning",
    icon: "🤖",
    accent: GROUP_COLOR.persist,
    items: [
      { name: "XGBoost", why: "Gradient-Boosting für den Podium-Classifier." },
      { name: "FastF1", why: "Historische Renndaten (Quali, Ergebnisse, Wetter)." },
      { name: "SHAP", why: "Erklärbarkeit — welches Feature treibt die Vorhersage." },
    ],
  },
  {
    title: "Qualität & Betrieb",
    icon: "🛡️",
    accent: GROUP_COLOR.push,
    items: [
      { name: "GitHub Actions CI", why: "Lint, Typecheck, Tests, cdk synth — grün auf main." },
      { name: "Zod (doppelte Validierung)", why: "Schema-Drift schlägt laut fehl, nie still." },
      { name: "CloudWatch Alarme + Budget", why: "Jeder Lambda überwacht; 5-USD-Budget-Alarm." },
    ],
  },
];
