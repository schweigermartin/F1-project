import { CONN_PK_ATTR, CONN_SK_ATTR, CONN_TTL_ATTR } from "@f1/shared";
import { RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { type ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";

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
  }
}
