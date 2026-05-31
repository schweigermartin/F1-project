#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";

import { DataLayerStack } from "../lib/data-layer-stack.js";
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
  // $connect origin allowlist (Constitution VII). Exact prod origin + local
  // dev; deliberately not a `*.vercel.app` wildcard (preview deploys can't
  // open the public socket). Add a wildcard entry here if previews need it.
  allowedOrigins: [
    "https://f1-project-martins-projects-bec7d357.vercel.app",
    "http://localhost:3000",
  ],
});

// Constitution Artikel III: every resource gets these tags so we can audit
// which stack/phase any cost line item belongs to.
Tags.of(app).add("Project", "f1");
Tags.of(app).add("ManagedBy", "cdk");
