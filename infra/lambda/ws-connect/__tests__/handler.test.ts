import { CONN_PK_ATTR, CONN_SK_ATTR, CONN_TTL_ATTR, connPK } from "@f1/shared";
import { describe, expect, it, vi } from "vitest";

import { buildConnectionItem, handleConnect } from "../handler.js";

const NOW = new Date("2026-05-24T20:00:00.000Z");

describe("buildConnectionItem", () => {
  it("keys the row by conn# PK + meta SK with a 2h TTL", () => {
    const item = buildConnectionItem("abc123=", NOW);
    expect(item[CONN_PK_ATTR]).toBe(connPK("abc123="));
    expect(item[CONN_SK_ATTR]).toBe("meta");
    expect(item[CONN_TTL_ATTR]).toBe(Math.floor(NOW.getTime() / 1000) + 7200);
    expect(item["connectedAt"]).toBe(NOW.toISOString());
  });
});

describe("handleConnect", () => {
  it("puts exactly one connection row", async () => {
    const putConnection = vi.fn().mockResolvedValue(undefined);
    await handleConnect({ connectionId: "abc123=" }, { putConnection, now: () => NOW });
    expect(putConnection).toHaveBeenCalledOnce();
    expect(putConnection.mock.calls[0]?.[0]).toMatchObject({ connectionId: "abc123=" });
  });

  it("propagates a DDB failure (API Gateway then rejects the connect)", async () => {
    const putConnection = vi.fn().mockRejectedValue(new Error("ddb down"));
    await expect(
      handleConnect({ connectionId: "x" }, { putConnection, now: () => NOW }),
    ).rejects.toThrow("ddb down");
  });
});
