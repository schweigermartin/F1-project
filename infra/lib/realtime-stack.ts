import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CONN_PK_ATTR, CONN_SK_ATTR, CONN_TTL_ATTR } from "@f1/shared";
import { RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { WebSocketApi, WebSocketStage } from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { type ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lambdaDir = (sub: string): string => path.resolve(__dirname, "..", "lambda", sub);

export interface RealtimeStackProps extends StackProps {
  /** F1Live table from PipelineStack — its stream feeds the fanout λ (T5). */
  readonly liveTable: ITableV2;
  /** Shared data bucket — the replay λ reads archived sessions from it (T6). */
  readonly dataBucket: IBucket;
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
  readonly subscribeFn: lambda.IFunction;

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

    // ─── WebSocket API ────────────────────────────────────────────────────
    // Route selection on $request.body.action (CDK default) drives the
    // custom routes (subscribe / replay) added in T4+. $connect auth lands
    // in T8.
    this.webSocketApi = new WebSocketApi(this, "RealtimeApi", {
      apiName: "F1-Realtime",
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration("ConnectIntegration", this.connectFn),
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
  }
}
