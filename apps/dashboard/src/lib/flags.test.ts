import { describe, expect, it } from "vitest";

import { countryToCode, nationalityToCode } from "./flags";

describe("countryToCode", () => {
  it("maps F1 race countries to ISO codes (case-insensitive)", () => {
    expect(countryToCode("Monaco")).toBe("mc");
    expect(countryToCode("italy")).toBe("it");
    expect(countryToCode("UK")).toBe("gb");
    expect(countryToCode("USA")).toBe("us");
    expect(countryToCode("  Bahrain ")).toBe("bh");
  });

  it("returns null for unknown or missing input", () => {
    expect(countryToCode("Atlantis")).toBeNull();
    expect(countryToCode(undefined)).toBeNull();
  });
});

describe("nationalityToCode", () => {
  it("maps driver/constructor nationalities to ISO codes", () => {
    expect(nationalityToCode("British")).toBe("gb");
    expect(nationalityToCode("Dutch")).toBe("nl");
    expect(nationalityToCode("Monegasque")).toBe("mc");
    expect(nationalityToCode("italian")).toBe("it");
  });

  it("returns null for unknown or missing input", () => {
    expect(nationalityToCode("Martian")).toBeNull();
    expect(nationalityToCode(undefined)).toBeNull();
  });
});
