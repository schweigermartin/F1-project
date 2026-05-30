import { CONN_PK_ATTR, CONN_SK_ATTR, CONN_TTL_ATTR } from "@f1/shared";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";
import { describe, it } from "vitest";

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
