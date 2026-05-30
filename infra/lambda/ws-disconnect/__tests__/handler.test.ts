import { CONN_PK_ATTR, CONN_SK_ATTR, connPK } from "@f1/shared";
import { describe, expect, it, vi } from "vitest";

import { connectionKey, handleDisconnect } from "../handler.js";

describe("connectionKey", () => {
  it("targets the conn# PK + meta SK", () => {
    expect(connectionKey("abc123=")).toEqual({
      [CONN_PK_ATTR]: connPK("abc123="),
      [CONN_SK_ATTR]: "meta",
    });
  });
});

describe("handleDisconnect", () => {
  it("deletes exactly the connection's row", async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    await handleDisconnect({ connectionId: "abc123=" }, { deleteConnection });
    expect(deleteConnection).toHaveBeenCalledOnce();
    expect(deleteConnection.mock.calls[0]?.[0]).toEqual({
      [CONN_PK_ATTR]: connPK("abc123="),
      [CONN_SK_ATTR]: "meta",
    });
  });

  it("propagates a DDB failure", async () => {
    const deleteConnection = vi.fn().mockRejectedValue(new Error("ddb down"));
    await expect(handleDisconnect({ connectionId: "x" }, { deleteConnection })).rejects.toThrow(
      "ddb down",
    );
  });
});
