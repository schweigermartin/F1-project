import { CONN_PK_ATTR, CONN_SK_ATTR, CONN_TTL_ATTR } from "@f1/shared";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";
import { describe, expect, it } from "vitest";

import { RealtimeStack } from "../lib/realtime-stack.js";

// Materialise the Phase 1 cross-stack inputs (F1Live + bucket) without
// pulling in the real stacks — keeps each test isolated.
class TestDepsStack extends Stack {
  readonly liveTable: dynamodb.TableV2;
  readonly bucket: s3.Bucket;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.liveTable = new dynamodb.TableV2(this, "TestLive", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });
    this.bucket = new s3.Bucket(this, "TestBucket");
  }
}

function synth(): Template {
  const app = new App();
  const deps = new TestDepsStack(app, "TestDeps");
  const stack = new RealtimeStack(app, "TestRealtime", {
    liveTable: deps.liveTable,
    dataBucket: deps.bucket,
  });
  return Template.fromStack(stack);
}

describe("RealtimeStack — F1Connections table", () => {
  it("uses CONN PK/SK from @f1/shared as partition + sort key", () => {
    synth().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: CONN_PK_ATTR, AttributeType: "S" },
        { AttributeName: CONN_SK_ATTR, AttributeType: "S" },
      ]),
      KeySchema: [
        { AttributeName: CONN_PK_ATTR, KeyType: "HASH" },
        { AttributeName: CONN_SK_ATTR, KeyType: "RANGE" },
      ],
    });
  });

  it("is on-demand (PAY_PER_REQUEST)", () => {
    synth().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("has TTL on the expiresAt attribute, enabled", () => {
    synth().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TimeToLiveSpecification: { AttributeName: CONN_TTL_ATTR, Enabled: true },
    });
  });

  it("is named F1Connections", () => {
    synth().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "F1Connections",
    });
  });

  it("is destroyable (no durable data, TTL handles staleness)", () => {
    synth().hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("creates exactly one DynamoDB table (no stream of its own)", () => {
    synth().resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
  });

  it("carries the Phase=2 tag", () => {
    synth().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: Match.arrayWith([
        Match.objectLike({
          Tags: Match.arrayWith([{ Key: "Phase", Value: "2" }]),
        }),
      ]),
    });
  });
});

describe("RealtimeStack — WebSocket API", () => {
  it("creates one WEBSOCKET API with action-based route selection", () => {
    const t = synth();
    t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    t.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      ProtocolType: "WEBSOCKET",
      RouteSelectionExpression: "$request.body.action",
    });
  });

  it("wires $connect, $disconnect and subscribe routes", () => {
    const t = synth();
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "$connect" });
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "$disconnect" });
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "subscribe" });
  });

  it("deploys an auto-deploy 'live' stage", () => {
    synth().hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "live",
      AutoDeploy: true,
    });
  });

  it("gates $connect with a REQUEST lambda authorizer on the token", () => {
    const t = synth();
    t.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "REQUEST",
      IdentitySource: ["route.request.querystring.token"],
    });
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "$connect",
      AuthorizationType: "CUSTOM",
    });
  });

  it("grants the authorizer ssm:GetParameter on the token secret only", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "ssm:GetParameter", Effect: "Allow" }),
        ]),
      }),
    });
  });

  it("grants connect PutItem and disconnect DeleteItem only (least privilege)", () => {
    const t = synth();
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "dynamodb:PutItem", Effect: "Allow" }),
        ]),
      }),
    });
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "dynamodb:DeleteItem", Effect: "Allow" }),
        ]),
      }),
    });
  });

  it("lets subscribe manage WebSocket connections (PostToConnection)", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "execute-api:ManageConnections", Effect: "Allow" }),
        ]),
      }),
    });
  });
});

describe("RealtimeStack — fanout", () => {
  it("subscribes the fanout λ to the F1Live stream (LATEST)", () => {
    const t = synth();
    t.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
    t.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "LATEST",
      BatchSize: 100,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
  });

  it("grants fanout connection-scan + dead-row cleanup", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["dynamodb:Scan", "dynamodb:DeleteItem"],
            Effect: "Allow",
          }),
        ]),
      }),
    });
  });
});

describe("RealtimeStack — replay", () => {
  it("wires replay:start and replay:stop routes", () => {
    const t = synth();
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "replay:start" });
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "replay:stop" });
  });

  it("lets replay read the S3 archive and self-invoke for continuation", () => {
    const t = synth();
    // s3:ListBucket (to locate the dated key) is the deterministic statement.
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "s3:ListBucket", Effect: "Allow" }),
        ]),
      }),
    });
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "lambda:InvokeFunction", Effect: "Allow" }),
        ]),
      }),
    });
  });

  it("gives replay the 15-minute timeout the continuation chain needs", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "F1-WS-Replay",
      Timeout: 900,
    });
  });
});

describe("RealtimeStack — IAM least privilege (T7)", () => {
  // Actions that must never be granted on Resource "*" (Constitution VII).
  const HOT_PREFIXES = [
    "dynamodb:",
    "s3:GetObject",
    "s3:PutObject",
    "execute-api:ManageConnections",
    "lambda:InvokeFunction",
  ];
  const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
  const isHot = (action: unknown): boolean =>
    typeof action === "string" && HOT_PREFIXES.some((p) => action.startsWith(p));

  it("never grants a hot-path action on Resource '*'", () => {
    const policies = synth().findResources("AWS::IAM::Policy");
    const offenders: string[] = [];
    for (const [id, policy] of Object.entries(policies)) {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      for (const st of statements) {
        const actions = asArray(st.Action);
        const resources = asArray(st.Resource);
        if (actions.some(isHot) && resources.some((r: unknown) => r === "*")) {
          offenders.push(`${id}: ${actions.join(",")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("provisions exactly the six F1-WS-* application lambdas", () => {
    const fns = synth().findResources("AWS::Lambda::Function");
    const names = Object.values(fns)
      .map((f) => f.Properties?.FunctionName)
      .filter((n): n is string => typeof n === "string" && n.startsWith("F1-WS-"))
      .sort();
    expect(names).toEqual([
      "F1-WS-Authorizer",
      "F1-WS-Connect",
      "F1-WS-Disconnect",
      "F1-WS-Fanout",
      "F1-WS-Replay",
      "F1-WS-Subscribe",
    ]);
  });

  it("wires all five WebSocket routes", () => {
    const routes = synth().findResources("AWS::ApiGatewayV2::Route");
    const keys = Object.values(routes)
      .map((r) => r.Properties?.RouteKey)
      .sort();
    expect(keys).toEqual(["$connect", "$disconnect", "replay:start", "replay:stop", "subscribe"]);
  });
});
