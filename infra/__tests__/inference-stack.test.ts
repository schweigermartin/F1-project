import { PK_ATTR, SK_ATTR } from "@f1/shared";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import { type Construct } from "constructs";
import { describe, expect, it } from "vitest";

import { InferenceStack } from "../lib/inference-stack.js";

class TestDepsStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly topic: sns.Topic;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.bucket = new s3.Bucket(this, "TestBucket");
    this.topic = new sns.Topic(this, "TestTopic");
  }
}

function synth(): Template {
  const app = new App();
  const deps = new TestDepsStack(app, "TestDeps");
  const stack = new InferenceStack(app, "TestInference", {
    dataBucket: deps.bucket,
    alertTopic: deps.topic,
  });
  return Template.fromStack(stack);
}

describe("InferenceStack — F1Predictions table", () => {
  it("uses the shared PK/SK and is on-demand", () => {
    synth().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      KeySchema: [
        { AttributeName: PK_ATTR, KeyType: "HASH" },
        { AttributeName: SK_ATTR, KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("has NO TTL — predictions are durable for the Phase 5 feedback loop", () => {
    synth().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TimeToLiveSpecification: Match.absent(),
    });
  });

  it("is retained on stack destroy (don't drop the prediction history)", () => {
    synth().hasResource("AWS::DynamoDB::GlobalTable", { DeletionPolicy: "Retain" });
  });
});

describe("InferenceStack — inference lambda", () => {
  it("is an ARM64 Docker-image function with the required env", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "F1-Inference",
      PackageType: "Image",
      Architectures: ["arm64"],
      Environment: {
        Variables: Match.objectLike({
          PREDICTIONS_TABLE: Match.anyValue(),
          MODEL_BUCKET: Match.anyValue(),
          BEDROCK_MODEL_ID: Match.stringLikeRegexp("claude-haiku-4-5"),
        }),
      },
    });
  });

  it("has a long timeout for the FastF1 feature build", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "F1-Inference",
      Timeout: 600,
    });
  });
});

describe("InferenceStack — IAM least privilege", () => {
  it("grants bedrock:InvokeModel only on scoped model ARNs, never '*'", () => {
    const template = synth();
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "bedrock:InvokeModel",
            Resource: Match.not("*"),
          }),
        ]),
      },
    });
  });

  it("scopes DynamoDB to Put/Get/Query on the predictions table only", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query"],
          }),
        ]),
      },
    });
  });

  it("grants S3 read scoped to the models/ prefix", () => {
    const json = JSON.stringify(synth().toJSON());
    expect(json).toContain("models/*");
  });
});

describe("InferenceStack — trigger pathway", () => {
  it("has a scheduler-assumable invoke role", () => {
    synth().hasResourceProperties("AWS::IAM::Role", {
      RoleName: "F1-Scheduler-InvokeInference",
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRole",
            Principal: { Service: "scheduler.amazonaws.com" },
          }),
        ]),
      },
    });
  });
});

describe("InferenceStack — alarms + dashboard (Constitution VIII)", () => {
  it("alarms on any inference lambda error → the SNS alert topic", () => {
    const template = synth();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "F1-Inference-Errors",
      MetricName: "Errors",
      Namespace: "AWS/Lambda",
      ComparisonOperator: "GreaterThanThreshold",
      Threshold: 0,
      AlarmActions: Match.anyValue(),
    });
  });

  it("alarms on a high Bedrock error rate (best-effort explanations)", () => {
    synth().hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "F1-Inference-BedrockErrorRate",
      ComparisonOperator: "GreaterThanThreshold",
      Metrics: Match.arrayWith([
        Match.objectLike({ MetricStat: Match.objectLike({ Metric: Match.anyValue() }) }),
      ]),
    });
  });

  it("has a silence alarm — fired but produced zero drivers", () => {
    synth().hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "F1-Inference-NoPredictions",
      MetricName: "InferenceDrivers",
      Namespace: "F1/Inference",
      ComparisonOperator: "LessThanOrEqualToThreshold",
      Threshold: 0,
      TreatMissingData: "notBreaching",
    });
  });

  it("publishes the f1-inference dashboard", () => {
    synth().hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: "f1-inference",
    });
  });
});
