import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ENDPOINT_PAYLOAD_SCHEMAS,
  type OpenF1DataEndpoint,
  SessionSchema,
} from "../src/openf1-schema.js";

/**
 * Validates that the on-disk fixtures (collected by ml/scripts/fetch_fixtures.py)
 * are accepted by the production Zod schemas. The fixtures are checked-in so
 * this runs in CI too — schema drift in OpenF1 will fail this test loudly
 * instead of silently breaking the Consumer lambda.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SESSION = "11291"; // Montréal Race 2026-05-24
const FIXTURE_DIR = resolve(HERE, "..", "..", "..", "ml", "fixtures", "openf1", FIXTURE_SESSION);

function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, relativePath), "utf-8"));
}

describe(`OpenF1 fixtures — session ${FIXTURE_SESSION} (Montréal Race)`, () => {
  it("session.json validates against SessionSchema", () => {
    const data = loadJson("session.json");
    expect(() => SessionSchema.parse(data)).not.toThrow();
  });

  const endpoints: OpenF1DataEndpoint[] = ["position", "intervals", "laps", "stints", "weather"];
  for (const endpoint of endpoints) {
    it(`${endpoint}.json validates against ENDPOINT_PAYLOAD_SCHEMAS["${endpoint}"]`, () => {
      const data = loadJson(`${endpoint}.json`);
      const schema = ENDPOINT_PAYLOAD_SCHEMAS[endpoint];
      const result = schema.safeParse(data);
      if (!result.success) {
        // Print the first error so CI logs are actionable.
        const firstIssue = result.error.issues[0];
        throw new Error(
          `${endpoint} validation failed at ${firstIssue?.path.join(".")}: ${firstIssue?.message}`,
        );
      }
      expect(Array.isArray(data)).toBe(true);
      expect((data as unknown[]).length).toBeGreaterThan(0);
    });
  }
});
