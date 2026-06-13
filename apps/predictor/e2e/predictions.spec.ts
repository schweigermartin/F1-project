import { expect, test } from "@playwright/test";

/**
 * Smoke test (Constitution X): open the predictor and assert the core user
 * flow. Against the local dev server this runs in demo mode (seeded board), so
 * it's hermetic — no Read-API needed. Against a deployed preview (BASE_URL set)
 * it asserts the same shell over real predictions.
 */
test("loads, lists drivers sorted by podium probability, click opens the reason", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Podiums-Predictor" })).toBeVisible();

  // The board renders one bar (button) per driver.
  const bars = page.getByRole("button");
  await expect(bars.first()).toBeVisible();
  expect(await bars.count()).toBeGreaterThanOrEqual(3);

  // US-1: bars are ordered by descending podium probability. Read the integer
  // percentage out of each bar's text ("LEC 83 %" → 83).
  const texts = await bars.allInnerTexts();
  const percentages = texts.map((t) => Number.parseInt(t.replace(/[^\d]/g, ""), 10));
  const sorted = [...percentages].sort((a, b) => b - a);
  expect(percentages).toEqual(sorted);

  // US-2: clicking a bar expands its Bedrock explanation.
  const top = bars.first();
  await expect(top).toHaveAttribute("aria-expanded", "false");
  await top.click();
  await expect(top).toHaveAttribute("aria-expanded", "true");
  // The seeded top driver (LEC) carries a known explanation sentence.
  await expect(page.getByText(/Souveräne Pole-Position/)).toBeVisible();

  // Phase 5 (AC-3): the season-performance chart renders below the board —
  // in demo mode with three seeded evaluations, against a deployed preview
  // possibly as its empty state; either way the section must be there.
  await expect(page.getByRole("heading", { name: "Saison-Performance" })).toBeVisible();
});
