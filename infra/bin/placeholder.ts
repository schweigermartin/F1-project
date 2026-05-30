import { bucketName, S3_PATHS } from "@f1/shared";

// Smoke test for the @f1/shared workspace import (Phase 0 T4 verify).
// Real CDK app entrypoint lands here in T6.
export const INFRA_PLACEHOLDER = {
  bucket: bucketName("123456789012", "eu-central-1"),
  exampleSessionKey: S3_PATHS.rawSession("2026-03-15", "bahrain-race"),
  exampleModelKey: S3_PATHS.modelArtifact("0.1.0"),
};
