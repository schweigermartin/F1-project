import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { PK_ATTR, SK_ATTR, TTL_ATTR } from "@f1/shared";
import { ArnFormat, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { type Construct } from "constructs";

import { INFERENCE_FN_NAME, INFERENCE_SCHEDULER_ROLE_NAME } from "./inference-stack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lambdaDir = (sub: string): string => path.resolve(__dirname, "..", "lambda", sub);

/** Active published model the inference schedules point at (models/<v>/, Ph. 3). */
const ACTIVE_MODEL_VERSION = "0.1.0";

export interface PipelineStackProps extends StackProps {
  readonly dataBucket: IBucket;
}

/**
 * PipelineStack — owns the ingest loop:
 *   EventBridge → Poller λ → SQS+DLQ → Consumer λ → DDB + S3 parts → Archiver λ
 *   plus a daily Schedule-Sync λ that opens/closes the polling window per session.
 *
 * Filled across T5–T13; current contents:
 *   T5 ✓ — F1LiveTable (Single-Table, TTL, Streams, On-Demand)
 *   T6 ✓ — EventsQueue + EventsQueueDLQ
 *   T7 ✓ — Poller λ source
 *   T8 ✓ — Consumer λ source
 *   T9 ✓ — Archiver λ source
 *   T10 ✓ — Schedule-Sync λ source
 *   T11 ✓ — wiring: NodejsFunction bundling, EventSources, EventBridge, IAM
 *   T13 — CloudWatch dashboard + alarms
 */
export class PipelineStack extends Stack {
  readonly dataBucket: IBucket;
  readonly liveTable: dynamodb.TableV2;
  readonly eventsQueue: sqs.Queue;
  readonly eventsDlq: sqs.Queue;
  readonly pollerFn: lambda.IFunction;
  readonly consumerFn: lambda.IFunction;
  readonly archiverFn: lambda.IFunction;
  readonly scheduleSyncFn: lambda.IFunction;
  readonly schedulerInvokeRole: iam.Role;
  readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    Tags.of(this).add("Phase", "1");

    this.dataBucket = props.dataBucket;

    // ─── SQS + DLQ ────────────────────────────────────────────────────────
    this.eventsDlq = new sqs.Queue(this, "EventsQueueDLQ", {
      queueName: "F1-Events-DLQ",
      retentionPeriod: Duration.days(7),
      enforceSSL: true,
    });

    this.eventsQueue = new sqs.Queue(this, "EventsQueue", {
      queueName: "F1-Events",
      retentionPeriod: Duration.days(1),
      visibilityTimeout: Duration.seconds(60),
      enforceSSL: true,
      deadLetterQueue: { queue: this.eventsDlq, maxReceiveCount: 3 },
    });

    // ─── DynamoDB Single-Table ────────────────────────────────────────────
    this.liveTable = new dynamodb.TableV2(this, "F1LiveTable", {
      tableName: "F1Live",
      partitionKey: { name: PK_ATTR, type: dynamodb.AttributeType.STRING },
      sortKey: { name: SK_ATTR, type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: TTL_ATTR,
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });

    // ─── Lambda baseline ──────────────────────────────────────────────────
    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.TWO_WEEKS,
      bundling: {
        format: OutputFormat.ESM,
        target: "node20",
        // The Lambda runtime ships AWS SDK v3, so don't bundle it.
        externalModules: ["@aws-sdk/*"] as string[],
      },
    };

    // ─── Poller λ ─────────────────────────────────────────────────────────
    this.pollerFn = new NodejsFunction(this, "PollerFn", {
      functionName: "F1-Poller",
      entry: path.join(lambdaDir("poller"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { EVENTS_QUEUE_URL: this.eventsQueue.queueUrl },
    });
    this.eventsQueue.grantSendMessages(this.pollerFn);

    // ─── Consumer λ ───────────────────────────────────────────────────────
    this.consumerFn = new NodejsFunction(this, "ConsumerFn", {
      functionName: "F1-Consumer",
      entry: path.join(lambdaDir("consumer"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        LIVE_TABLE_NAME: this.liveTable.tableName,
        DATA_BUCKET_NAME: this.dataBucket.bucketName,
      },
    });
    this.consumerFn.addEventSource(
      new SqsEventSource(this.eventsQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
        reportBatchItemFailures: true,
      }),
    );
    this.liveTable.grantWriteData(this.consumerFn);
    this.dataBucket.grantPut(this.consumerFn, "raw/sessions/*/parts/*");

    // ─── Archiver λ ───────────────────────────────────────────────────────
    this.archiverFn = new NodejsFunction(this, "ArchiverFn", {
      functionName: "F1-Archiver",
      entry: path.join(lambdaDir("archiver"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 512,
      timeout: Duration.minutes(5),
      environment: { DATA_BUCKET_NAME: this.dataBucket.bucketName },
    });
    this.dataBucket.grantReadWrite(this.archiverFn, "raw/sessions/*");
    this.dataBucket.grantDelete(this.archiverFn, "raw/sessions/*/parts/*");
    new events.Rule(this, "ArchiverSchedule", {
      schedule: events.Schedule.rate(Duration.minutes(15)),
      targets: [new targets.LambdaFunction(this.archiverFn)],
    });

    // ─── Schedule-Sync λ ─────────────────────────────────────────────────
    // Scheduler-invoke role: aws-scheduler assumes this to invoke the Poller.
    this.schedulerInvokeRole = new iam.Role(this, "SchedulerInvokeRole", {
      roleName: "F1-Scheduler-InvokePoller",
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      inlinePolicies: {
        InvokePoller: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["lambda:InvokeFunction"],
              resources: [this.pollerFn.functionArn],
            }),
          ],
        }),
      },
    });

    this.scheduleSyncFn = new NodejsFunction(this, "ScheduleSyncFn", {
      functionName: "F1-ScheduleSync",
      entry: path.join(lambdaDir("schedule-sync"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 256,
      timeout: Duration.minutes(1),
      environment: {
        POLLER_FUNCTION_ARN: this.pollerFn.functionArn,
        SCHEDULER_ROLE_ARN: this.schedulerInvokeRole.roleArn,
        // Phase 4: also program one-shot inference schedules. Built from the
        // known InferenceStack names (not cross-stack refs) to avoid a
        // Pipeline↔Inference dependency cycle.
        INFERENCE_FUNCTION_ARN: Stack.of(this).formatArn({
          service: "lambda",
          resource: "function",
          resourceName: INFERENCE_FN_NAME,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
        INFERENCE_SCHEDULER_ROLE_ARN: Stack.of(this).formatArn({
          service: "iam",
          region: "",
          resource: "role",
          resourceName: INFERENCE_SCHEDULER_ROLE_NAME,
        }),
        MODEL_VERSION: ACTIVE_MODEL_VERSION,
      },
    });
    // Manage f1-poll-* schedules; pass the invoke role to scheduler.
    this.scheduleSyncFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:GetSchedule",
          "scheduler:ListSchedules",
        ],
        resources: ["*"], // aws-scheduler resource ARNs are dynamic; limit by name-prefix at the IAM level isn't supported directly.
      }),
    );
    this.scheduleSyncFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        // The poller's scheduler role (this stack) + the inference scheduler
        // role (InferenceStack, built from its known name to avoid a cycle).
        resources: [
          this.schedulerInvokeRole.roleArn,
          Stack.of(this).formatArn({
            service: "iam",
            region: "",
            resource: "role",
            resourceName: INFERENCE_SCHEDULER_ROLE_NAME,
          }),
        ],
      }),
    );
    new events.Rule(this, "ScheduleSyncDailyCron", {
      // 04:00 UTC daily — pulls the year's sessions, schedules the next 48h.
      schedule: events.Schedule.cron({ minute: "0", hour: "4" }),
      targets: [new targets.LambdaFunction(this.scheduleSyncFn)],
    });

    // ─── Alerts (SNS) + Alarms ────────────────────────────────────────────
    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: "f1-alerts",
      displayName: "F1 Pipeline Alerts",
    });
    alertTopic.addSubscription(new snsSubs.EmailSubscription("martin_schweiger@outlook.de"));
    // Shared with RealtimeStack (Phase 2) so all phases alert to one place.
    this.alertTopic = alertTopic;
    const alertAction = new cwActions.SnsAction(alertTopic);

    // DLQ-depth: any message in the DLQ is a real problem.
    new cloudwatch.Alarm(this, "DLQDepthAlarm", {
      alarmName: "F1-DLQ-Depth",
      metric: this.eventsDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: "Maximum",
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // Poller error rate: >5% errored invocations over 5 min.
    new cloudwatch.Alarm(this, "PollerErrorRateAlarm", {
      alarmName: "F1-Poller-ErrorRate",
      metric: new cloudwatch.MathExpression({
        expression: "errors / IF(invocations > 0, invocations, 1) * 100",
        usingMetrics: {
          errors: this.pollerFn.metricErrors({ period: Duration.minutes(5) }),
          invocations: this.pollerFn.metricInvocations({ period: Duration.minutes(5) }),
        },
        period: Duration.minutes(5),
      }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // Schedule-sync failed: this lambda runs once a day; a single error
    // means tomorrow's race-weekend won't be polled.
    new cloudwatch.Alarm(this, "ScheduleSyncFailureAlarm", {
      alarmName: "F1-ScheduleSync-Failure",
      metric: this.scheduleSyncFn.metricErrors({ period: Duration.minutes(15) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // Consumer error rate.
    new cloudwatch.Alarm(this, "ConsumerErrorRateAlarm", {
      alarmName: "F1-Consumer-ErrorRate",
      metric: new cloudwatch.MathExpression({
        expression: "errors / IF(invocations > 0, invocations, 1) * 100",
        usingMetrics: {
          errors: this.consumerFn.metricErrors({ period: Duration.minutes(5) }),
          invocations: this.consumerFn.metricInvocations({ period: Duration.minutes(5) }),
        },
        period: Duration.minutes(5),
      }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // ─── Dashboard ────────────────────────────────────────────────────────
    new cloudwatch.Dashboard(this, "PipelineDashboard", {
      dashboardName: "f1-pipeline",
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "SQS depth (Events vs DLQ)",
            left: [
              this.eventsQueue.metricApproximateNumberOfMessagesVisible(),
              this.eventsDlq.metricApproximateNumberOfMessagesVisible({
                color: cloudwatch.Color.RED,
              }),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Lambda invocations",
            left: [
              this.pollerFn.metricInvocations(),
              this.consumerFn.metricInvocations(),
              this.archiverFn.metricInvocations(),
              this.scheduleSyncFn.metricInvocations(),
            ],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "Lambda errors",
            left: [
              this.pollerFn.metricErrors({ color: cloudwatch.Color.RED }),
              this.consumerFn.metricErrors({ color: cloudwatch.Color.ORANGE }),
              this.archiverFn.metricErrors(),
              this.scheduleSyncFn.metricErrors(),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "DDB consumed capacity (writes + reads)",
            left: [
              this.liveTable.metricConsumedWriteCapacityUnits(),
              this.liveTable.metricConsumedReadCapacityUnits(),
            ],
            width: 12,
          }),
        ],
      ],
    });
  }
}
