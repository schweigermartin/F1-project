import { Stack, type StackProps } from "aws-cdk-lib";
import { type Construct } from "constructs";

/**
 * DataLayerStack — owns the S3 bucket (Phase 0 T7) and, later, the DynamoDB
 * Single-Table (Phase 1 T5). Both are shared across the dashboard and predictor
 * apps, so they live in their own stack and never get torn down by app-level
 * deploys.
 *
 * T6 (this file) is the empty skeleton — the bucket is added in T7.
 */
export class DataLayerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
  }
}
