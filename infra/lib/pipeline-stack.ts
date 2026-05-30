import { PK_ATTR, SK_ATTR, TTL_ATTR } from "@f1/shared";
import { Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
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
 * Filled across T5–T11; current contents:
 *   T5 ✓ — F1LiveTable (Single-Table, TTL, Streams, On-Demand)
 *   T6 ✓ — EventsQueue + EventsQueueDLQ (Standard, redrive, enforceSSL)
 *   T7 — Poller λ
 *   T8 — Consumer λ
 *   T9 — Archiver λ
 *   T10 — Schedule-Sync λ
 *   T11 — wiring (EventSources, EventBridge rules, IAM, CloudWatch)
 */
export class PipelineStack extends Stack {
  readonly dataBucket: IBucket;
  readonly liveTable: dynamodb.TableV2;
  readonly eventsQueue: sqs.Queue;
  readonly eventsDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    Tags.of(this).add("Phase", "1");

    this.dataBucket = props.dataBucket;

    // ─── SQS + DLQ ────────────────────────────────────────────────────────
    // Standard queue, not FIFO: ordering is reconstructed by the Archiver
    // when it sorts S3 parts by `fetched_at` (plan §5). FIFO would cap
    // throughput and cost more, with no benefit here.
    this.eventsDlq = new sqs.Queue(this, "EventsQueueDLQ", {
      queueName: "F1-Events-DLQ",
      retentionPeriod: Duration.days(7),
      enforceSSL: true,
    });

    this.eventsQueue = new sqs.Queue(this, "EventsQueue", {
      queueName: "F1-Events",
      retentionPeriod: Duration.days(1),
      // 60s = ~6× Consumer-Lambda timeout (10s). Plenty of headroom for the
      // SQS partial-batch retry pattern (T8) without blocking too long.
      visibilityTimeout: Duration.seconds(60),
      enforceSSL: true,
      deadLetterQueue: {
        queue: this.eventsDlq,
        // 3 attempts: enough to ride out transient DDB throttling, low
        // enough that a poison message lands in DLQ within seconds.
        maxReceiveCount: 3,
      },
    });

    this.liveTable = new dynamodb.TableV2(this, "F1LiveTable", {
      tableName: "F1Live",
      partitionKey: { name: PK_ATTR, type: dynamodb.AttributeType.STRING },
      sortKey: { name: SK_ATTR, type: dynamodb.AttributeType.STRING },
      // PAY_PER_REQUEST on TableV2 is the L2 default ("billing.onDemand()")
      billing: dynamodb.Billing.onDemand(),
      // TTL: epoch-seconds attribute; expired items auto-evicted within 48h.
      timeToLiveAttribute: TTL_ATTR,
      // Streams feed Phase 2's WebSocket push: both images so the dashboard
      // can render a useful delta (e.g. "P3 → P2 for #16").
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      // DESTROY: live state is ephemeral by design (TTL 24h) and S3 archive is
      // the durable copy. Stack tear-down should drop the table cleanly.
      removalPolicy: RemovalPolicy.DESTROY,
      // Point-in-time recovery off — cost-bearing and we have S3 as truth.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });
  }
}
