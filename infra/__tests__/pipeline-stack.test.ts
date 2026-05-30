import { PK_ATTR, SK_ATTR, TTL_ATTR } from "@f1/shared";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as s3 from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";
import { describe, it } from "vitest";

import { PipelineStack } from "../lib/pipeline-stack.js";

// Tiny helper stack just to materialise a Bucket without pulling in the
// real DataLayerStack — keeps each test isolated.
class TestBucketStack extends Stack {
  readonly bucket: s3.Bucket;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.bucket = new s3.Bucket(this, "TestBucket");
  }
}

function synth(): Template {
  const app = new App();
  const bucketStack = new TestBucketStack(app, "TestBucketStack");
  const stack = new PipelineStack(app, "TestPipeline", {
    dataBucket: bucketStack.bucket,
  });
  return Template.fromStack(stack);
}

describe("PipelineStack — F1LiveTable", () => {
  it("uses PK/SK from @f1/shared as partition + sort key", () => {
    const t = synth();
    t.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: PK_ATTR, AttributeType: "S" },
        { AttributeName: SK_ATTR, AttributeType: "S" },
      ]),
      KeySchema: [
        { AttributeName: PK_ATTR, KeyType: "HASH" },
        { AttributeName: SK_ATTR, KeyType: "RANGE" },
      ],
    });
  });

  it("is configured as on-demand (PAY_PER_REQUEST)", () => {
    const t = synth();
    t.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("has TTL on the expiresAt attribute, enabled", () => {
    const t = synth();
    t.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TimeToLiveSpecification: { AttributeName: TTL_ATTR, Enabled: true },
    });
  });

  it("emits NEW_AND_OLD_IMAGES stream (Phase 2 needs both)", () => {
    const t = synth();
    t.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
    });
  });

  it("can be destroyed by stack tear-down (TTL + S3 archive are the durability story)", () => {
    const t = synth();
    t.hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("creates exactly one DynamoDB table", () => {
    synth().resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
  });

  it("carries the Phase=1 tag (TableV2 nests tags per replica)", () => {
    const t = synth();
    t.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: Match.arrayWith([
        Match.objectLike({
          Tags: Match.arrayWith([{ Key: "Phase", Value: "1" }]),
        }),
      ]),
    });
  });
});

describe("PipelineStack — SQS EventsQueue + DLQ", () => {
  it("creates exactly two SQS queues (main + DLQ)", () => {
    synth().resourceCountIs("AWS::SQS::Queue", 2);
  });

  it("DLQ is named F1-Events-DLQ with 7 day retention", () => {
    synth().hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "F1-Events-DLQ",
      MessageRetentionPeriod: 7 * 24 * 60 * 60,
    });
  });

  it("main queue has 1 day retention and 60s visibility timeout", () => {
    synth().hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "F1-Events",
      MessageRetentionPeriod: 24 * 60 * 60,
      VisibilityTimeout: 60,
    });
  });

  it("main queue redrives to the DLQ after 3 failed attempts", () => {
    synth().hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "F1-Events",
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
        deadLetterTargetArn: Match.anyValue(),
      }),
    });
  });

  it("both queues deny non-TLS traffic via bucket-policy-style rule", () => {
    const t = synth();
    // enforceSSL adds an AWS::SQS::QueuePolicy with a Deny on aws:SecureTransport=false.
    t.resourceCountIs("AWS::SQS::QueuePolicy", 2);
    t.hasResourceProperties("AWS::SQS::QueuePolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      }),
    });
  });
});
