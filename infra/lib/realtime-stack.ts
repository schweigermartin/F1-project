import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CONN_PK_ATTR, CONN_SK_ATTR, CONN_TTL_ATTR } from "@f1/shared";
import {
  ArnFormat,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Tags,
} from "aws-cdk-lib";
import { WebSocketApi, WebSocketStage } from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { type ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { type Construct } from "constructs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lambdaDir = (sub: string): string => path.resolve(__dirname, "..", "lambda", sub);

/**
 * SSM SecureString holding the WS token HMAC secret. Created out-of-band
 * (never in the template, Constitution VII):
 *   aws ssm put-parameter --name /f1/ws-token-secret --type SecureString --value <random>
 */
const WS_TOKEN_SECRET_PARAM = "/f1/ws-token-secret";

export interface RealtimeStackProps extends StackProps {
  /** F1Live table from PipelineStack — its stream feeds the fanout λ (T5). */
  readonly liveTable: ITableV2;
  /** Shared data bucket — the replay λ reads archived sessions from it (T6). */
  readonly dataBucket: IBucket;
  /** Origin allowlist for the $connect authorizer (exact or `*.suffix`). */
  readonly allowedOrigins?: string[];
  /** Shared SNS alert topic from PipelineStack — all phases alert here. */
  readonly alertTopic: ITopic;
}

/**
 * RealtimeStack — owns the WebSocket layer that turns the Phase 1 pipeline
 * into a live, public dashboard:
 *   API GW WebSocket → connect/subscribe/replay λ + fanout λ (off the F1Live
 *   stream) → posts deltas back to subscribed browsers.
 *
 * It consumes the Phase 1 building blocks (F1Live stream + data bucket) as
 * cross-stack references — same pattern as PipelineStack taking the bucket —
 * so the shared base is never duplicated (Constitution III).
 *
 * Filled across T2–T13; current contents:
 *   T2 ✓ — F1Connections table (ephemeral connection registry)
 *   T3 — WebSocket API + connect/disconnect λ
 *   T4 — subscribe λ + snapshot
 *   T5 — fanout λ (DDB stream → delta)
 *   T6 — replay λ (S3 JSONL → paced stream)
 *   T7 — wiring + IAM
 *   T8 — connect authorizer
 *   T13 — observability
 */
export class RealtimeStack extends Stack {
  readonly liveTable: ITableV2;
  readonly dataBucket: IBucket;
  readonly connectionsTable: dynamodb.TableV2;
  readonly webSocketApi: WebSocketApi;
  readonly webSocketStage: WebSocketStage;
  readonly connectFn: lambda.IFunction;
  readonly disconnectFn: lambda.IFunction;
  readonly authorizerFn: lambda.IFunction;
  readonly subscribeFn: lambda.IFunction;
  readonly fanoutFn: lambda.IFunction;
  readonly replayFn: lambda.Function;

  constructor(scope: Construct, id: string, props: RealtimeStackProps) {
    super(scope, id, props);
    Tags.of(this).add("Phase", "2");

    this.liveTable = props.liveTable;
    this.dataBucket = props.dataBucket;

    // ─── Connections registry ─────────────────────────────────────────────
    // One row per live WebSocket connection: connectionId → subscribed
    // session + replay state. Separate table from F1Live (different
    // lifecycle — ephemeral session-tracking, not race data; Constitution III).
    // RemovalPolicy.DESTROY: holds nothing durable, and a stale row is caught
    // by the 2h TTL anyway (the common missed-$disconnect failure mode).
    this.connectionsTable = new dynamodb.TableV2(this, "F1ConnectionsTable", {
      tableName: "F1Connections",
      partitionKey: { name: CONN_PK_ATTR, type: dynamodb.AttributeType.STRING },
      sortKey: { name: CONN_SK_ATTR, type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: CONN_TTL_ATTR,
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
      environment: { CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName },
    };

    // ─── Connect / Disconnect λ ───────────────────────────────────────────
    this.connectFn = new NodejsFunction(this, "WsConnectFn", {
      functionName: "F1-WS-Connect",
      entry: path.join(lambdaDir("ws-connect"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 256,
    });
    // Least privilege (Constitution VII): connect only ever PutItems its row.
    this.connectFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem"],
        resources: [this.connectionsTable.tableArn],
      }),
    );

    this.disconnectFn = new NodejsFunction(this, "WsDisconnectFn", {
      functionName: "F1-WS-Disconnect",
      entry: path.join(lambdaDir("ws-disconnect"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 256,
    });
    // Disconnect only ever DeleteItems its own row (also aborts a replay).
    this.disconnectFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:DeleteItem"],
        resources: [this.connectionsTable.tableArn],
      }),
    );

    // ─── $connect authorizer λ ────────────────────────────────────────────
    // Anti-abuse gate (Constitution VII): origin allowlist + short-lived HMAC
    // token. The secret lives in SSM as a SecureString, created out-of-band
    // (never in the template) and read with decryption at runtime.
    this.authorizerFn = new NodejsFunction(this, "WsAuthorizerFn", {
      functionName: "F1-WS-Authorizer",
      entry: path.join(lambdaDir("ws-authorizer"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 256,
      environment: {
        WS_TOKEN_SECRET_PARAM: WS_TOKEN_SECRET_PARAM,
        ALLOWED_ORIGINS: props.allowedOrigins?.join(",") ?? "http://localhost:3000",
      },
    });
    this.authorizerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          Stack.of(this).formatArn({
            service: "ssm",
            resource: "parameter",
            // SSM parameter ARNs drop the leading slash of the name.
            resourceName: WS_TOKEN_SECRET_PARAM.replace(/^\//, ""),
          }),
        ],
      }),
    );

    const authorizer = new WebSocketLambdaAuthorizer("ConnectAuthorizer", this.authorizerFn, {
      identitySource: ["route.request.querystring.token"],
    });

    // ─── WebSocket API ────────────────────────────────────────────────────
    // Route selection on $request.body.action (CDK default) drives the
    // custom routes (subscribe / replay). $connect is gated by the authorizer.
    this.webSocketApi = new WebSocketApi(this, "RealtimeApi", {
      apiName: "F1-Realtime",
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration("ConnectIntegration", this.connectFn),
        authorizer,
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration("DisconnectIntegration", this.disconnectFn),
      },
    });

    this.webSocketStage = new WebSocketStage(this, "LiveStage", {
      webSocketApi: this.webSocketApi,
      stageName: "live",
      autoDeploy: true,
    });

    // The wss:// endpoint to copy into the frontend's NEXT_PUBLIC_WS_URL.
    new CfnOutput(this, "WebSocketUrl", {
      value: this.webSocketStage.url,
      description: "wss endpoint for the dashboard's NEXT_PUBLIC_WS_URL",
    });

    // ─── Subscribe λ ──────────────────────────────────────────────────────
    // Resolves the session, records the subscription, and posts the initial
    // snapshot built from F1Live state.
    this.subscribeFn = new NodejsFunction(this, "WsSubscribeFn", {
      functionName: "F1-WS-Subscribe",
      entry: path.join(lambdaDir("ws-subscribe"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 512,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        LIVE_TABLE_NAME: this.liveTable.tableName,
      },
    });
    // Read-only on the live data; only updates its own connection row.
    this.liveTable.grantReadData(this.subscribeFn);
    this.subscribeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:UpdateItem"],
        resources: [this.connectionsTable.tableArn],
      }),
    );
    // PostToConnection back to the subscriber.
    this.webSocketApi.grantManageConnections(this.subscribeFn);

    this.webSocketApi.addRoute("subscribe", {
      integration: new WebSocketLambdaIntegration("SubscribeIntegration", this.subscribeFn),
    });

    // ─── Fanout λ (F1Live stream → delta) ─────────────────────────────────
    // Consumes the F1Live DDB stream and pushes per-entity deltas to every
    // connection subscribed to that session. Closes the live path.
    this.fanoutFn = new NodejsFunction(this, "WsFanoutFn", {
      functionName: "F1-WS-Fanout",
      entry: path.join(lambdaDir("ws-fanout"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 512,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        WS_CALLBACK_URL: this.webSocketStage.callbackUrl,
      },
    });
    // Stream-read perms are added by DynamoEventSource. Subscriber lookup +
    // dead-connection cleanup on the connections table; PostToConnection.
    this.fanoutFn.addEventSource(
      new DynamoEventSource(this.liveTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(2),
        bisectBatchOnError: true,
        retryAttempts: 3,
        reportBatchItemFailures: true,
      }),
    );
    this.fanoutFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Scan", "dynamodb:DeleteItem"],
        resources: [this.connectionsTable.tableArn],
      }),
    );
    this.webSocketApi.grantManageConnections(this.fanoutFn);

    // ─── Replay λ (S3 JSONL → paced stream) ───────────────────────────────
    // replayStart sets state + fires an async self-invoke; the playback runs
    // in continuation invocations (not bound by the 29s WS integration
    // timeout), chaining via cursor until the session ends (R-3).
    const replayFnName = "F1-WS-Replay";
    this.replayFn = new NodejsFunction(this, "WsReplayFn", {
      functionName: replayFnName,
      entry: path.join(lambdaDir("ws-replay"), "index.ts"),
      handler: "handler",
      ...lambdaDefaults,
      memorySize: 512,
      timeout: Duration.minutes(15),
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        DATA_BUCKET_NAME: this.dataBucket.bucketName,
        WS_CALLBACK_URL: this.webSocketStage.callbackUrl,
      },
    });
    this.dataBucket.grantRead(this.replayFn, "raw/sessions/*");
    this.replayFn.addToRolePolicy(
      new iam.PolicyStatement({
        // List to locate the dated key; the bucket-level ARN is required for List.
        actions: ["s3:ListBucket"],
        resources: [this.dataBucket.bucketArn],
        conditions: { StringLike: { "s3:prefix": ["raw/sessions/*"] } },
      }),
    );
    this.replayFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        resources: [this.connectionsTable.tableArn],
      }),
    );
    this.webSocketApi.grantManageConnections(this.replayFn);
    // Self-invoke for the continuation chain. Build the ARN from the known
    // function name rather than this.replayFn.functionArn (a GetAtt) — the
    // latter would make the function's own role policy depend on the function,
    // creating an undeployable dependency cycle.
    this.replayFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          Stack.of(this).formatArn({
            service: "lambda",
            resource: "function",
            resourceName: replayFnName,
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );

    // Route keys mirror the ClientMessage `action` values. They must be
    // colon-free — API GW rejects `replay:start` ("route key is not formatted
    // properly") — so they're camelCase, matching @f1/shared/ws-messages.
    const replayIntegration = new WebSocketLambdaIntegration("ReplayIntegration", this.replayFn);
    this.webSocketApi.addRoute("replayStart", { integration: replayIntegration });
    this.webSocketApi.addRoute("replayStop", { integration: replayIntegration });

    // ─── Alarms + Dashboard (Constitution VIII) ───────────────────────────
    const alertAction = new cwActions.SnsAction(props.alertTopic);

    const errorRatePercent = (fn: lambda.IFunction): cloudwatch.MathExpression =>
      new cloudwatch.MathExpression({
        expression: "errors / IF(invocations > 0, invocations, 1) * 100",
        usingMetrics: {
          errors: fn.metricErrors({ period: Duration.minutes(5) }),
          invocations: fn.metricInvocations({ period: Duration.minutes(5) }),
        },
        period: Duration.minutes(5),
      });

    // Fanout failing means live deltas stop reaching browsers mid-session.
    new cloudwatch.Alarm(this, "FanoutErrorRateAlarm", {
      alarmName: "F1-Fanout-ErrorRate",
      metric: errorRatePercent(this.fanoutFn),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // A replay error breaks the always-available demo (Constitution V).
    new cloudwatch.Alarm(this, "ReplayFailureAlarm", {
      alarmName: "F1-Replay-Failure",
      metric: this.replayFn.metricErrors({ period: Duration.minutes(15) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    // If the authorizer errors (e.g. SSM unreachable) nobody can connect.
    new cloudwatch.Alarm(this, "AuthorizerFailureAlarm", {
      alarmName: "F1-Authorizer-Failure",
      metric: this.authorizerFn.metricErrors({ period: Duration.minutes(5) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alertAction);

    const apiMetric = (metricName: string): cloudwatch.Metric =>
      new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName,
        dimensionsMap: { ApiId: this.webSocketApi.apiId, Stage: this.webSocketStage.stageName },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

    new cloudwatch.Dashboard(this, "RealtimeDashboard", {
      dashboardName: "f1-realtime",
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "WebSocket API (connections + messages)",
            left: [apiMetric("ConnectCount"), apiMetric("MessageCount")],
            right: [apiMetric("ExecutionError"), apiMetric("ClientError")],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "WS Lambda invocations",
            left: [
              this.connectFn.metricInvocations(),
              this.subscribeFn.metricInvocations(),
              this.fanoutFn.metricInvocations(),
              this.replayFn.metricInvocations(),
              this.authorizerFn.metricInvocations(),
            ],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "WS Lambda errors",
            left: [
              this.fanoutFn.metricErrors({ color: cloudwatch.Color.RED }),
              this.subscribeFn.metricErrors({ color: cloudwatch.Color.ORANGE }),
              this.replayFn.metricErrors(),
              this.authorizerFn.metricErrors(),
              this.connectFn.metricErrors(),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Fanout vs replay duration (p95)",
            left: [
              this.fanoutFn.metricDuration({ statistic: "p95" }),
              this.replayFn.metricDuration({ statistic: "p95" }),
            ],
            width: 12,
          }),
        ],
      ],
    });
  }
}
