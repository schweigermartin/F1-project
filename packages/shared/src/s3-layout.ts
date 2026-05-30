/**
 * S3 path layout — single source of truth for every read/write across all phases.
 * Anything that constructs an S3 key MUST import from here. No string literals elsewhere.
 *
 * Constitution III (geteilte Basis): Phase 1 (Pipeline) and Phase 3 (ML) both consume this.
 */

export const S3_BUCKET_PREFIX = "f1-data" as const;

/**
 * Deterministic, collision-free bucket name. AWS S3 names must be globally unique;
 * including account-id + region guarantees that without coordination.
 */
export function bucketName(accountId: string, region: string): string {
  return `${S3_BUCKET_PREFIX}-${accountId}-${region}`;
}

export const S3_PATHS = {
  /** Final consolidated session archive — written by the Archiver lambda after session end. */
  rawSession: (date: string, sessionId: string): string =>
    `raw/sessions/${date}/${sessionId}.jsonl`,

  /** Per-tick part written by the Consumer lambda before the Archiver consolidates them. */
  rawSessionPart: (date: string, sessionId: string, fetchedAt: string, msgId: string): string =>
    `raw/sessions/${date}/${sessionId}/parts/${fetchedAt}-${msgId}.jsonl`,

  /** Prefix used by the Archiver lambda to list all parts for a session. */
  rawSessionPartsPrefix: (date: string, sessionId: string): string =>
    `raw/sessions/${date}/${sessionId}/parts/`,

  /** Trained model artifact, versioned via SemVer (Constitution IX). */
  modelArtifact: (version: string): string => `models/${version}/model.json`,

  /** Human-readable model card alongside the artifact (Constitution IX). */
  modelCard: (version: string): string => `models/${version}/model_card.md`,
} as const;

export type S3PathBuilders = typeof S3_PATHS;
