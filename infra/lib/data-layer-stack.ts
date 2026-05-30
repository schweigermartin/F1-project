import { bucketName } from "@f1/shared";
import { Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";

/**
 * DataLayerStack — owns the S3 bucket (Phase 0 T7) and, later, the DynamoDB
 * Single-Table (Phase 1 T5). Both are shared across dashboard and predictor
 * apps, so they live in their own stack and never get torn down by app-level
 * deploys.
 *
 * The bucket layout (raw/sessions/*, models/*, _tmp/*) is defined in
 * @f1/shared/s3-layout — every reader/writer imports from there.
 */
export class DataLayerStack extends Stack {
  readonly dataBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    Tags.of(this).add("Phase", "0");

    this.dataBucket = new s3.Bucket(this, "DataBucket", {
      bucketName: bucketName(this.account, this.region),
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // RETAIN: this bucket holds the only copy of the live archive. A stack
      // destroy must NOT delete the data — explicit manual cleanup only.
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "raw-sessions-archive",
          prefix: "raw/sessions/",
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(30),
            },
          ],
          expiration: Duration.days(180),
          noncurrentVersionExpiration: Duration.days(30),
        },
        {
          // models/ intentionally has NO expiration — versioning IS the
          // retention strategy (Constitution IX).
          id: "models-noncurrent-cleanup",
          prefix: "models/",
          noncurrentVersionExpiration: Duration.days(365),
        },
        {
          id: "tmp-cleanup",
          prefix: "_tmp/",
          expiration: Duration.days(1),
          noncurrentVersionExpiration: Duration.days(1),
        },
        {
          // Hygiene: never let aborted multipart uploads (from interrupted
          // archive writes) sit around accruing cost.
          id: "abort-stale-multipart",
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    });
  }
}
