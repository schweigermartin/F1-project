import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { PK_ATTR, SK_ATTR } from "@f1/shared";
import { Duration, RemovalPolicy, Size, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { type Construct } from "constructs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * Claude Haiku 4.5 on Bedrock in eu-central-1 (Spec Q-1 / D2). EU inference
 * profile — verify the exact id at deploy (`aws bedrock list-inference-profiles`)
 * and adjust if needed (T13). The lambda also receives it as BEDROCK_MODEL_ID.
 */
const BEDROCK_MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";
const CLAUDE_HAIKU_FM_PATTERN = "anthropic.claude-haiku-4-5-*";

/** Known names so PipelineStack's schedule-sync can build the ARNs without a
 * cross-stack reference (which would create a Pipeline↔Inference cycle). */
export const INFERENCE_FN_NAME = "F1-Inference";
export const INFERENCE_SCHEDULER_ROLE_NAME = "F1-Scheduler-InvokeInference";

export interface InferenceStackProps extends StackProps {
  /** Shared data bucket — the inference λ reads models/<version>/model.json. */
  readonly dataBucket: IBucket;
  /** Shared SNS alert topic from PipelineStack — all phases alert here (T9). */
  readonly alertTopic: ITopic;
}

/**
 * InferenceStack (Phase 4) — closes Project 1: once per race (T-60min) it runs
 * the XGBoost model, writes per-driver podium predictions, and caches a Claude
 * (Bedrock) explanation next to each one.
 *
 * Separate F1Predictions table from F1Live (Constitution III deviation, see
 * plan): predictions have a different lifecycle (one write per race, no 24h
 * TTL) and Phase 5 compares them against the actual results, so they must not
 * expire. The model artifact is read cross-stack from the shared data bucket.
 *
 *   T8  ✓ — table + Docker inference λ + IAM + scheduler-invoke role
 *   T9  — alarms + dashboard
 *   T10 — read-API (separate construct/stack)
 */
export class InferenceStack extends Stack {
  readonly predictionsTable: dynamodb.TableV2;
  readonly inferenceFn: lambda.DockerImageFunction;
  readonly schedulerInvokeRole: iam.Role;

  constructor(scope: Construct, id: string, props: InferenceStackProps) {
    super(scope, id, props);
    Tags.of(this).add("Phase", "4");

    // ─── Predictions table ────────────────────────────────────────────────
    // On-demand, no TTL: a row is the durable record Phase 5 reads back. RETAIN
    // so a stack teardown never drops the accumulated prediction-vs-actual
    // history (same bias as the DataLayer bucket).
    this.predictionsTable = new dynamodb.TableV2(this, "F1PredictionsTable", {
      tableName: "F1Predictions",
      partitionKey: { name: PK_ATTR, type: dynamodb.AttributeType.STRING },
      sortKey: { name: SK_ATTR, type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });

    // ─── Inference λ (first Python/Docker lambda — xgboost/shap won't zip) ──
    // Build context is the repo root so the image can install the ml/ package;
    // `exclude` keeps the asset hash off node_modules/.git (the Dockerfile only
    // COPYs ml/ + the adapter, so nothing else reaches the image regardless).
    this.inferenceFn = new lambda.DockerImageFunction(this, "InferenceFn", {
      functionName: INFERENCE_FN_NAME,
      code: lambda.DockerImageCode.fromImageAsset(repoRoot, {
        file: "infra/lambda/inference/Dockerfile",
        platform: Platform.LINUX_ARM64,
        // Build context is the repo root (the image installs ml/). Exclude all
        // build artifacts + dirs the Dockerfile never COPYs — critically
        // `**/cdk.out` (it lives in the context and would recurse into itself)
        // and the Python/Node caches.
        exclude: [
          ".git",
          "**/node_modules",
          "**/cdk.out",
          "**/__pycache__",
          "**/.pytest_cache",
          "**/.mypy_cache",
          "**/.ruff_cache",
          "**/.venv",
          "**/.fastf1-cache",
          "**/.next",
          "**/dist",
          "**/coverage",
          "ml/artifacts",
          "apps",
          "packages",
          "specs",
          "docs",
          ".github",
        ],
      }),
      architecture: lambda.Architecture.ARM_64,
      // Heavy: loads the model + builds features from FastF1 history once per
      // race. Generous memory (= more CPU) + timeout; it runs ~24×/year (IV).
      memorySize: 3008,
      timeout: Duration.minutes(10),
      ephemeralStorageSize: Size.mebibytes(2048), // /tmp: model.json + FastF1 cache
      environment: {
        PREDICTIONS_TABLE: this.predictionsTable.tableName,
        MODEL_BUCKET: props.dataBucket.bucketName,
        BEDROCK_MODEL_ID,
      },
    });

    // ─── IAM (least privilege, Constitution VII) ──────────────────────────
    // Read only the model artifacts; never the live archive.
    props.dataBucket.grantRead(this.inferenceFn, "models/*");

    // Write predictions/explanations + read the cache — exactly Put/Get/Query.
    this.inferenceFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query"],
        resources: [this.predictionsTable.tableArn],
      }),
    );

    // Invoke only the one Claude model — never bedrock:* on `*`. Grant the EU
    // inference profile (what we call) and the underlying foundation model
    // (what the profile fans out to across EU regions).
    this.inferenceFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          Stack.of(this).formatArn({
            service: "bedrock",
            region: this.region,
            account: this.account,
            resource: "inference-profile",
            resourceName: BEDROCK_MODEL_ID,
          }),
          Stack.of(this).formatArn({
            service: "bedrock",
            region: "*",
            account: "",
            resource: "foundation-model",
            resourceName: CLAUDE_HAIKU_FM_PATTERN,
          }),
        ],
      }),
    );

    // ─── Trigger pathway ──────────────────────────────────────────────────
    // aws-scheduler assumes this role to fire the inference λ T-60min before a
    // race — same split as Phase 1 (the role lives in the stack; the per-race
    // schedule entries are programmed at runtime). See the README/plan for how
    // schedule-sync emits the race schedules.
    this.schedulerInvokeRole = new iam.Role(this, "SchedulerInvokeRole", {
      roleName: INFERENCE_SCHEDULER_ROLE_NAME,
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      inlinePolicies: {
        InvokeInference: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["lambda:InvokeFunction"],
              // Build from the known name (not functionArn) to avoid a role↔fn cycle.
              resources: [
                Stack.of(this).formatArn({
                  service: "lambda",
                  resource: "function",
                  resourceName: INFERENCE_FN_NAME,
                }),
              ],
            }),
          ],
        }),
      },
    });
  }
}
