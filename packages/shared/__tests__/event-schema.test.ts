import { describe, expect, it } from "vitest";

import { PIPELINE_EVENT_SCHEMA_VERSION, PipelineEventSchema } from "../src/event-schema.js";

const baseEvent = {
  session_id: "11291",
  endpoint: "position" as const,
  payload: [{ anything: "goes here, validated later" }],
  fetched_at: "2026-05-24T20:15:00.000+00:00",
  schema_version: PIPELINE_EVENT_SCHEMA_VERSION,
};

describe("PipelineEventSchema", () => {
  it("accepts a well-formed message", () => {
    expect(() => PipelineEventSchema.parse(baseEvent)).not.toThrow();
  });

  it("rejects an unknown endpoint", () => {
    expect(() => PipelineEventSchema.parse({ ...baseEvent, endpoint: "telemetry" })).toThrow();
  });

  it("rejects a wrong schema_version (defends against partial Poller upgrades)", () => {
    expect(() => PipelineEventSchema.parse({ ...baseEvent, schema_version: 2 })).toThrow();
  });

  it("rejects a missing session_id", () => {
    const { session_id: _drop, ...rest } = baseEvent;
    expect(() => PipelineEventSchema.parse(rest)).toThrow();
  });
});
