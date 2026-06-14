import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ARCHIVER_EVENT_SOURCE, PK_ATTR, SESSION_ARCHIVED_DETAIL_TYPE, SK_ATTR } from "@f1/shared";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
  Tags,
} from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { type Construct } from "constructs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const lambdaDir = (sub: string): string => path.resolve(__dirname, "..", "lambda", sub);

/**
 * Claude Haiku 4.5 on Bedrock in eu-central-1 (Spec Q-1 / D2). EU inference
 * profile — verify the exact id at deploy (`aws bedrock list-inference-profiles`)
 * and adjust if needed (T13). The lambda also receives it as BEDROCK_MODEL_ID.
 */
const BEDROCK_MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";
const CLAUDE_HAIKU_FM_PATTERN = "anthropic.claude-haiku-4-5-*";

/** EMF namespace the inference λ writes its custom metrics under. Mirrors
 * `_METRIC_NAMESPACE` in infra/lambda/inference/lambda_function.py — keep in sync. */
const METRIC_NAMESPACE = "F1/Inference";

/** EMF namespace of the evaluation λ (Phase 5). Mirrors the literal in
 * infra/lambda/evaluation/index.ts — keep in sync. */
const EVALUATION_METRIC_NAMESPACE = "F1/Evaluation";

/** Known names so PipelineStack's schedule-sync can build the ARNs without a
 * cross-stack reference (which would create a Pipeline↔Inference cycle). */
export const INFERENCE_FN_NAME = "F1-Inference";
export const INFERENCE_SCHEDULER_ROLE_NAME = "F1-Scheduler-InvokeInference";
/** DLQ for the one-shot inference schedules: if aws-scheduler fires but can't
 * deliver to the inference λ (the silent 2026-06-14 failure — schedule fired,
 * 0 invocations, then self-deleted via ActionAfterCompletion=DELETE, leaving no
 * trace and no alarm), the failed event lands here and trips the DLQ alarm.
 * Fixed name so PipelineStack's schedule-sync can build the ARN without a cross-
 * stack ref (same decoupling as INFERENCE_FN_NAME). */
export const INFERENCE_SCHEDULER_DLQ_NAME = "F1-Inference-Scheduler-DLQ";

export interface InferenceStackProps extends StackProps {
  /** Shared data bucket — the inference λ reads models/<version>/model.json. */
  readonly dataBucket: IBucket;
  /** Shared SNS alert topic from PipelineStack — all phases alert here (T9). */
  readonly alertTopic: ITopic;
  /** CORS origin allowlist for the Read-API Function URL (predictor Vercel
   * domain + localhost). Never `*` (Constitution VII). Defaults to localhost. */
  readonly allowedOrigins?: string[];
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
 *   T9  ✓ — alarms (errors / bedrock-error-rate / silence) + dashboard
 *   T10 ✓ — read-API λ (Function URL, CORS-scoped, Query-only) for the frontend
 */
export class InferenceStack extends Stack {
  readonly predictionsTable: dynamodb.TableV2;
  readonly inferenceFn: lambda.DockerImageFunction;
  readonly schedulerInvokeRole: iam.Role;
  readonly readApiFn: lambda.Function;
  readonly readApiUrl: lambda.FunctionUrl;
  readonly evaluationFn: lambda.Function;

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
        // Lambda's CWD (/var/task) is read-only; FastF1 must cache under /tmp.
        FASTF1_CACHE_DIR: "/tmp/.fastf1-cache",
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
    // DLQ for failed scheduler→λ deliveries. A one-shot schedule self-deletes
    // after firing (ActionAfterCompletion=DELETE), so without a DLQ a failed
    // delivery vanishes silently — exactly the 2026-06-14 incident where the
    // race-day prediction never ran and nothing alerted. 14-day retention gives
    // ample time to notice and re-drive a missed race.
    const schedulerDlq = new sqs.Queue(this, "InferenceSchedulerDlq", {
      queueName: INFERENCE_SCHEDULER_DLQ_NAME,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

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
    // aws-scheduler delivers a failed invocation to the DLQ using the schedule's
    // execution role, so that role needs sqs:SendMessage on the DLQ.
    schedulerDlq.grantSendMessages(this.schedulerInvokeRole);

    // ─── Read-API (the frontend's only path to the predictions) ───────────
    const { fn, url } = this.addReadApi(props.allowedOrigins);
    this.readApiFn = fn;
    this.readApiUrl = url;

    // ─── Evaluation λ (Phase 5 — feedback loop) ───────────────────────────
    this.evaluationFn = this.addEvaluation(props.dataBucket);

    // ─── Alarms + dashboard (Constitution VIII) ───────────────────────────
    this.addMonitoring(props.alertTopic, schedulerDlq);
  }

  /**
   * Phase-5 feedback loop: fired by the Archiver's SessionArchived event, it
   * scores a race's predictions against the archived result and writes the
   * evaluation back into F1Predictions (race PK + season PK). Lives in this
   * stack on purpose — everything that reads/writes F1Predictions stays in
   * one place, and the feedback widgets extend the existing f1-inference
   * dashboard (a 4th dashboard would leave the CloudWatch free tier,
   * Constitution IV). No DLQ on the rule: a failed run pages via the error
   * alarm and a manual re-run is idempotent (see retraining runbook).
   */
  private addEvaluation(dataBucket: IBucket): lambda.Function {
    const fn = new NodejsFunction(this, "EvaluationFn", {
      functionName: "F1-Evaluation",
      entry: path.join(lambdaDir("evaluation"), "index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.TWO_WEEKS,
      // A full race archive is a few MB of JSONL; parsing it line-by-line is
      // memory-light but give it headroom + time for S3/OpenF1 round trips.
      memorySize: 512,
      timeout: Duration.minutes(2),
      bundling: {
        format: OutputFormat.ESM,
        target: "node20",
        externalModules: ["@aws-sdk/*"],
      },
      environment: {
        PREDICTIONS_TABLE: this.predictionsTable.tableName,
        DATA_BUCKET_NAME: dataBucket.bucketName,
      },
    });
    // The stack is tagged Phase 4; the feedback-loop constructs override to 5
    // so the cost/audit tags attribute them correctly (Constitution III).
    Tags.of(fn).add("Phase", "5");

    // Least privilege (Constitution VII): read only the session archive, and
    // exactly Query (predictions in) + PutItem (evaluation out) on the table.
    dataBucket.grantRead(fn, "raw/sessions/*");
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:PutItem"],
        resources: [this.predictionsTable.tableArn],
      }),
    );

    new events.Rule(this, "SessionArchivedRule", {
      description: "Archiver finished consolidating a session → evaluate it (Phase 5, AC-1).",
      eventPattern: {
        source: [ARCHIVER_EVENT_SOURCE],
        detailType: [SESSION_ARCHIVED_DETAIL_TYPE],
      },
      targets: [new targets.LambdaFunction(fn)],
    });

    return fn;
  }

  /**
   * Slim Node λ behind a Function URL: the predictor frontend (T11) fetches a
   * race's predictions here — never DDB/Bedrock directly (plan § security). It
   * holds only `dynamodb:Query` on F1Predictions (Constitution VII). CORS is
   * locked to the predictor origins (no `*`); the URL is unauthenticated
   * because the data is public race predictions, but the allowlist still keeps
   * other sites' browsers off it.
   */
  private addReadApi(allowedOrigins?: string[]): {
    fn: lambda.Function;
    url: lambda.FunctionUrl;
  } {
    const fn = new NodejsFunction(this, "PredictionsApiFn", {
      functionName: "F1-Predictions-Api",
      entry: path.join(lambdaDir("predictions-api"), "index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.TWO_WEEKS,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: {
        format: OutputFormat.ESM,
        target: "node20",
        externalModules: ["@aws-sdk/*"],
      },
      environment: { PREDICTIONS_TABLE: this.predictionsTable.tableName },
    });

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [this.predictionsTable.tableArn],
      }),
    );

    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: allowedOrigins ?? ["http://localhost:3000"],
        allowedMethods: [lambda.HttpMethod.GET],
        allowedHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });
    new CfnOutput(this, "PredictionsApiUrl", { value: url.url });

    return { fn, url };
  }

  /** One custom EMF metric emitted by the inference λ (namespace F1/Inference).
   * The λ runs ~24×/year, so default everything to Sum over a long-ish period;
   * `treatMissingData: NOT_BREACHING` keeps the off-season silence from paging. */
  private inferenceMetric(metricName: string, statistic = "Sum"): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: METRIC_NAMESPACE,
      metricName,
      statistic,
      period: Duration.minutes(5),
    });
  }

  private addMonitoring(alertTopic: ITopic, schedulerDlq: sqs.Queue): void {
    const alertAction = new cwActions.SnsAction(alertTopic);

    // 0. Scheduler→λ delivery failures. Alarms #1/#4 only fire once the λ has
    // *run* (errors / "ran but empty"); a schedule that fires but never reaches
    // the λ is invisible to them. Any message here means a race-day inference
    // never started — the gap behind the 2026-06-14 missed prediction.
    new cloudwatch.Alarm(this, "InferenceSchedulerDlqAlarm", {
      alarmName: "F1-Inference-SchedulerDLQ",
      metric: schedulerDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: "Maximum",
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // 1. Inference errors — any failed invocation is a missed race prediction.
    new cloudwatch.Alarm(this, "InferenceErrorsAlarm", {
      alarmName: "F1-Inference-Errors",
      metric: this.inferenceFn.metricErrors({ period: Duration.minutes(15) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // 2. Bedrock error rate — explanations are best-effort (never block a
    // prediction), but a high failure share means the whole grid ran without
    // narratives. Rate over attempts (calls + errors), guarded against /0.
    new cloudwatch.Alarm(this, "BedrockErrorRateAlarm", {
      alarmName: "F1-Inference-BedrockErrorRate",
      metric: new cloudwatch.MathExpression({
        expression: "errors / IF(errors + calls > 0, errors + calls, 1) * 100",
        usingMetrics: {
          errors: this.inferenceMetric("BedrockErrors"),
          calls: this.inferenceMetric("BedrockCalls"),
        },
        period: Duration.minutes(15),
      }),
      threshold: 50,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // 3. Read-API error rate — the frontend's only data path; >5% errored
    // invocations over 5 min means the predictor page is broken.
    new cloudwatch.Alarm(this, "ReadApiErrorRateAlarm", {
      alarmName: "F1-Predictions-Api-ErrorRate",
      metric: new cloudwatch.MathExpression({
        expression: "errors / IF(invocations > 0, invocations, 1) * 100",
        usingMetrics: {
          errors: this.readApiFn.metricErrors({ period: Duration.minutes(5) }),
          invocations: this.readApiFn.metricInvocations({ period: Duration.minutes(5) }),
        },
        period: Duration.minutes(5),
      }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // 4. Silence — the λ fired but produced zero drivers (e.g. no quali data).
    // The handler emits InferenceDrivers=0 in that case, so an alarm on
    // "metric present AND ≤ 0" distinguishes "ran but empty" from "never ran".
    new cloudwatch.Alarm(this, "InferenceSilenceAlarm", {
      alarmName: "F1-Inference-NoPredictions",
      metric: this.inferenceMetric("InferenceDrivers", "Maximum"),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // 5. Evaluation errors (Phase 5, AC-6) — a failed run means a race never
    // gets its hit-rate; the run is idempotent, so after the fix a manual
    // re-invoke recovers it (runbook).
    new cloudwatch.Alarm(this, "EvaluationErrorsAlarm", {
      alarmName: "F1-Evaluation-Errors",
      metric: this.evaluationFn.metricErrors({ period: Duration.minutes(15) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    new cloudwatch.Dashboard(this, "InferenceDashboard", {
      dashboardName: "f1-inference",
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "Inference invocations vs errors",
            left: [this.inferenceFn.metricInvocations()],
            right: [this.inferenceFn.metricErrors({ color: cloudwatch.Color.RED })],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Drivers predicted per run",
            left: [this.inferenceMetric("InferenceDrivers", "Maximum")],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "Bedrock calls vs cache hits vs errors",
            left: [
              this.inferenceMetric("BedrockCalls"),
              this.inferenceMetric("BedrockCacheHits", "Maximum"),
              this.inferenceMetric("BedrockErrors").with({ color: cloudwatch.Color.RED }),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Inference duration",
            left: [this.inferenceFn.metricDuration({ statistic: "Maximum" })],
            width: 12,
          }),
        ],
        // Phase-5 feedback loop: model quality over the season + eval health.
        [
          new cloudwatch.GraphWidget({
            title: "Model quality per race (hit-rate / brier)",
            left: [this.evaluationMetric("EvaluationHitRate")],
            right: [this.evaluationMetric("EvaluationBrier")],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Evaluation runs vs errors vs skips",
            left: [
              this.evaluationFn.metricInvocations(),
              this.evaluationMetric("EvaluationSkippedNoPredictions"),
            ],
            right: [this.evaluationFn.metricErrors({ color: cloudwatch.Color.RED })],
            width: 12,
          }),
        ],
      ],
    });
  }

  /** One EMF metric of the evaluation λ (namespace F1/Evaluation). Maximum
   * because hit-rate/brier are per-race values, not counters; the λ runs
   * ~24×/year so any aggregate over a period sees at most one sample. */
  private evaluationMetric(metricName: string): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: EVALUATION_METRIC_NAMESPACE,
      metricName,
      statistic: "Maximum",
      period: Duration.minutes(15),
    });
  }
}
