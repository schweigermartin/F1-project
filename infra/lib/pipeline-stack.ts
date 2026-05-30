import { Stack, type StackProps, Tags } from "aws-cdk-lib";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";

export interface PipelineStackProps extends StackProps {
  /**
   * Cross-stack reference to the shared data bucket from DataLayerStack.
   * Consumer (T8) writes parts here; Archiver (T9) reads + consolidates.
   */
  readonly dataBucket: IBucket;
}

/**
 * PipelineStack — owns the ingest loop:
 *   EventBridge → Poller λ → SQS+DLQ → Consumer λ → DDB + S3 parts → Archiver λ
 *   plus a daily Schedule-Sync λ that opens/closes the polling window per session.
 *
 * T4 is the empty skeleton. Components land in subsequent tasks:
 *   T5 — DynamoDB F1LiveTable (Single-Table + Streams + TTL)
 *   T6 — EventsQueue + EventsQueueDLQ
 *   T7 — Poller λ
 *   T8 — Consumer λ
 *   T9 — Archiver λ
 *   T10 — Schedule-Sync λ
 *   T11 — wiring (EventSources, EventBridge rules, IAM, CloudWatch)
 */
export class PipelineStack extends Stack {
  readonly dataBucket: IBucket;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    Tags.of(this).add("Phase", "1");

    this.dataBucket = props.dataBucket;
  }
}
