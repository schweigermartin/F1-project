import { driverPositionSK, PK_ATTR, SK_ATTR, TTL_ATTR, weatherSK } from "@f1/shared";
import { describe, expect, it, vi } from "vitest";

import {
  fanout,
  type FanoutDeps,
  type FanoutEvent,
  type FanoutRecord,
  imageToDelta,
} from "../handler.js";

function image(
  sk: string,
  endpoint: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return { [PK_ATTR]: "session#11291", [SK_ATTR]: sk, [TTL_ATTR]: 1_900_000_000, endpoint, ...row };
}

function insert(img: Record<string, unknown>): FanoutRecord {
  return { eventName: "INSERT", newImage: img };
}

describe("imageToDelta", () => {
  it("turns a position image into a typed delta, stripping DDB-internal attrs", () => {
    const d = imageToDelta(
      image(driverPositionSK(44), "position", { driver_number: 44, position: 3 }),
    );
    expect(d).not.toBeNull();
    expect(d!.session_id).toBe("11291");
    expect(d!.message.entity).toBe("position");
    expect(d!.message.data).toEqual({ endpoint: "position", driver_number: 44, position: 3 });
    expect(d!.message.data).not.toHaveProperty(PK_ATTR);
  });

  it("maps the weather singleton", () => {
    const d = imageToDelta(image(weatherSK(), "weather", { air_temperature: 24 }));
    expect(d!.message.entity).toBe("weather");
  });

  it("returns null for an unkeyable image (e.g. meta)", () => {
    expect(imageToDelta(image("meta", "meta", {}))).toBeNull();
  });

  it("returns null when PK is not a session key", () => {
    expect(imageToDelta({ [PK_ATTR]: "conn#x", [SK_ATTR]: "meta" })).toBeNull();
  });
});

function deps(over: Partial<FanoutDeps> = {}): FanoutDeps {
  return {
    listConnections: vi.fn().mockResolvedValue(["c1"]),
    post: vi.fn().mockResolvedValue(undefined),
    deleteConnection: vi.fn().mockResolvedValue(undefined),
    emitMetric: vi.fn(),
    ...over,
  };
}

const event: FanoutEvent = {
  Records: [
    insert(image(driverPositionSK(44), "position", { driver_number: 44, position: 3 })),
    insert(image(driverPositionSK(1), "position", { driver_number: 1, position: 1 })),
  ],
};

describe("fanout", () => {
  it("posts every delta to every subscribed connection", async () => {
    const d = deps({ listConnections: vi.fn().mockResolvedValue(["c1", "c2"]) });
    const result = await fanout(event, d);
    // 2 deltas × 2 connections
    expect(d.post).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ deltas: 2, posted: 4, gone: 0 });
  });

  it("looks up connections once per session (not per record)", async () => {
    const d = deps();
    await fanout(event, d);
    expect(d.listConnections).toHaveBeenCalledOnce();
  });

  it("is a no-op when nobody is subscribed", async () => {
    const d = deps({ listConnections: vi.fn().mockResolvedValue([]) });
    const result = await fanout(event, d);
    expect(d.post).not.toHaveBeenCalled();
    expect(result.posted).toBe(0);
  });

  it("skips REMOVE records (deletions/TTL are not pushed)", async () => {
    const d = deps();
    const result = await fanout({ Records: [{ eventName: "REMOVE" }] as FanoutRecord[] }, d);
    expect(result.deltas).toBe(0);
    expect(d.listConnections).not.toHaveBeenCalled();
  });

  it("deletes a 410-gone connection and does not fail the batch", async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce({ gone: true }) // first delta to c1 → gone
      .mockResolvedValue(undefined);
    const d = deps({ listConnections: vi.fn().mockResolvedValue(["c1"]), post });
    const result = await fanout(event, d);
    expect(d.deleteConnection).toHaveBeenCalledWith("c1");
    expect(result.gone).toBe(1);
  });

  it("rethrows a real post error so the stream source retries", async () => {
    const post = vi.fn().mockRejectedValue(new Error("throttled"));
    const d = deps({ post });
    await expect(fanout(event, d)).rejects.toThrow("throttled");
  });
});
