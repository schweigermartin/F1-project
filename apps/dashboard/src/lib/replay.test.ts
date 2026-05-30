import { describe, expect, it } from "vitest";

import { buildReplayStart, REPLAY_SPEEDS } from "./replay.js";

describe("buildReplayStart", () => {
  it("accepts a non-empty session id, trimming whitespace", () => {
    expect(buildReplayStart("  11291 ", 2)).toEqual({ ok: true, session_id: "11291", speed: 2 });
  });

  it("rejects an empty or whitespace-only session id", () => {
    expect(buildReplayStart("", 1)).toEqual({ ok: false });
    expect(buildReplayStart("   ", 4)).toEqual({ ok: false });
  });

  it("offers exactly the 1x/2x/4x speeds", () => {
    expect(REPLAY_SPEEDS).toEqual([1, 2, 4]);
  });
});
