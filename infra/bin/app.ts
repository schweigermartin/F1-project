#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";

import { DataLayerStack } from "../lib/data-layer-stack.js";
import { InferenceStack } from "../lib/inference-stack.js";
import { PipelineStack } from "../lib/pipeline-stack.js";
import { RealtimeStack } from "../lib/realtime-stack.js";

const account = process.env["CDK_DEFAULT_ACCOUNT"] ?? "128663321407";
const region = process.env["CDK_DEFAULT_REGION"] ?? "eu-central-1";

const app = new App();
const env = { account, region };

const dataLayer = new DataLayerStack(app, "F1-DataLayer", {
  env,
  description: "Shared data layer (S3 + DynamoDB) for the F1 portfolio project.",
});

const pipeline = new PipelineStack(app, "F1-Pipeline", {
  env,
  description: "OpenF1 ingest pipeline (EventBridge → Poller → SQS → Consumer → DDB + S3).",
  dataBucket: dataLayer.dataBucket,
});

new RealtimeStack(app, "F1-Realtime", {
  env,
  description:
    "WebSocket layer (API GW → fanout off F1Live stream + replay from S3) for the live dashboard.",
  liveTable: pipeline.liveTable,
  dataBucket: dataLayer.dataBucket,
  alertTopic: pipeline.alertTopic,
  // $connect origin allowlist (Constitution VII). Exact prod alias the
  // dashboard is served from + localhost for dev — deliberately no
  // `*.vercel.app` wildcard (least privilege). New Vercel URLs (e.g. preview
  // deploys) must be added here explicitly. The origin is only the cheap first
  // filter; the real gate is the HMAC token (server-minted, WS_TOKEN_SECRET).
  allowedOrigins: ["https://f1-project-zeta.vercel.app", "http://localhost:3000"],
});

new InferenceStack(app, "F1-Inference", {
  env,
  description:
    "Race outcome predictor (T-60min inference λ → XGBoost + Bedrock explanations → F1Predictions).",
  dataBucket: dataLayer.dataBucket,
  alertTopic: pipeline.alertTopic,
  // Read-API CORS allowlist (Constitution VII, no `*`). localhost for dev; the
  // predictor Vercel domain is added when the frontend ships (T11/T13).
  allowedOrigins: ["http://localhost:3000"],
});

// Constitution Artikel III: every resource gets these tags so we can audit
// which stack/phase any cost line item belongs to.
Tags.of(app).add("Project", "f1");
Tags.of(app).add("ManagedBy", "cdk");
