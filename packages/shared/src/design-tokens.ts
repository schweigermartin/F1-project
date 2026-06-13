/**
 * Shared design vocabulary (Phase 7, Constitution III). The two Next apps each
 * own their components, but colours/spacing/radius/typography come from ONE
 * place so the predictor hub, the dashboard landing and the live page read as a
 * single product (spec D-1).
 *
 * This file is pure data + a stringifier — it imports no CSS and pulls in no
 * runtime. Each app injects `tokensToCssVars()` into a `:root{}` block (in
 * `globals.css` or the layout) so every `var(--…)` resolves to the same value.
 * Existing CSS modules that already use `--bg`/`--fg`/`--accent` inherit the
 * shared values automatically — no per-component change required.
 */

/** Token groups → final CSS custom-property name is `--<group-prefix><key>`. */
export const DESIGN_TOKENS = {
  /** Core surface + text palette (dark theme — the project has always been dark). */
  color: {
    bg: "#0a0e14", // page background
    surface: "#121822", // card background
    "surface-2": "#1a2230", // nested/hover surface
    border: "#222c3a", // hairline borders
    fg: "#e6e6e6", // primary text
    muted: "#8a94a6", // secondary text
    accent: "#e10600", // F1 red — primary action/brand
    "accent-soft": "#ff4d47", // lighter red for gradients/hover
    pos: "#4ade80", // hit / positive SHAP / good
    neg: "#f87171", // miss / negative SHAP / bad
    warn: "#f59e0b", // brier / caution
    gold: "#ffd54a", // P1
    silver: "#cdd3da", // P2
    bronze: "#d8884a", // P3
  },
  /** 4px spacing scale, named t-shirt sizes for readability in CSS. */
  space: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.5rem",
    "2xl": "2.5rem",
  },
  radius: {
    sm: "6px",
    md: "10px",
    lg: "16px",
    pill: "999px",
  },
  font: {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    // A condensed/techy display stack for headings + numbers; falls back to sans.
    display:
      '"Rajdhani", "Eurostile", "Bahnschrift", ui-sans-serif, system-ui, -apple-system, sans-serif',
    mono: 'ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", monospace',
  },
  shadow: {
    card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35)",
  },
} as const;

export type DesignTokens = typeof DESIGN_TOKENS;
export type TokenGroup = keyof DesignTokens;

/** `color` → `--`, everything else → `--<group>-` (so `space.lg` → `--space-lg`). */
function prefixFor(group: TokenGroup): string {
  return group === "color" ? "--" : `--${group}-`;
}

/**
 * Flatten the token tree into `["--name", "value"]` pairs. Pure + deterministic
 * (insertion order), so a snapshot test can pin the exact variable list.
 */
export function tokenCssVarPairs(): Array<readonly [string, string]> {
  const pairs: Array<readonly [string, string]> = [];
  for (const group of Object.keys(DESIGN_TOKENS) as TokenGroup[]) {
    const prefix = prefixFor(group);
    for (const [key, value] of Object.entries(DESIGN_TOKENS[group])) {
      pairs.push([`${prefix}${key}`, value] as const);
    }
  }
  return pairs;
}

/**
 * Render the tokens as the body of a `:root{}` block (no selector, just the
 * declarations) so an app can inline it once. Example:
 *   `<style>{`:root{${tokensToCssVars()}}`}</style>`
 * or paste the output straight into `globals.css`.
 */
export function tokensToCssVars(): string {
  return tokenCssVarPairs()
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}
