#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";

import { DataLayerStack } from "../lib/data-layer-stack.js";
import { PipelineStack } from "../lib/pipeline-stack.js";

const account = process.env["CDK_DEFAULT_ACCOUNT"] ?? "128663321407";
const region = process.env["CDK_DEFAULT_REGION"] ?? "eu-central-1";

const app = new App();
const env = { account, region };

const dataLayer = new DataLayerStack(app, "F1-DataLayer", {
  env,
  description: "Shared data layer (S3 + DynamoDB) for the F1 portfolio project.",
});

new PipelineStack(app, "F1-Pipeline", {
  env,
  description: "OpenF1 ingest pipeline (EventBridge → Poller → SQS → Consumer → DDB + S3).",
  dataBucket: dataLayer.dataBucket,
});

// Constitution Artikel III: every resource gets these tags so we can audit
// which stack/phase any cost line item belongs to.
Tags.of(app).add("Project", "f1");
Tags.of(app).add("ManagedBy", "cdk");
