import { describe, expect, it } from "vitest";

import {
  DESIGN_TOKENS,
  tokenCssVarPairs,
  tokensToCssVars,
} from "../src/design-tokens.js";

describe("design tokens", () => {
  it("emits one CSS var per token across all groups", () => {
    const expected = Object.values(DESIGN_TOKENS).reduce(
      (sum, group) => sum + Object.keys(group).length,
      0,
    );
    expect(tokenCssVarPairs()).toHaveLength(expected);
  });

  it("prefixes colour tokens with `--` and other groups with `--<group>-`", () => {
    const names = new Map(tokenCssVarPairs());
    expect(names.get("--accent")).toBe("#e10600"); // colour → bare --
    expect(names.get("--space-lg")).toBe("1rem"); // grouped → --space-
    expect(names.get("--radius-pill")).toBe("999px");
  });

  it("renders a stable, declaration-only :root body", () => {
    const css = tokensToCssVars();
    expect(css.startsWith("--bg: #0a0e14;")).toBe(true);
    expect(css).toContain("--space-lg: 1rem;");
    expect(css).not.toContain(":root"); // body only, no selector
  });
});
