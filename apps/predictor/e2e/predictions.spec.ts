import { expect, test } from "@playwright/test";

/**
 * Smoke test (Constitution X): open the Race Weekend Hub and assert the core
 * panels + flow. Against the local dev server this runs in demo mode (seeded
 * data), so it's hermetic — no Read-API needed. Against a deployed preview
 * (BASE_URL set) it asserts the same shell over real data.
 */
test("renders the weekend hub panels and the podium flow", async ({ page }) => {
  await page.goto("/");

  // AC-1: weekend header with the race name (demo → Canada).
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The hub panels are present (AC-2/3/4/5/7/9).
  await expect(page.getByRole("heading", { name: "Strecke" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zeitplan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wetter" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Podiums-Vorhersage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saison-Performance" })).toBeVisible();

  // The podium board renders one card per driver, sorted by descending podium
  // probability (US-1). Read the clean "NN %" out of each card's prob badge.
  const probs = page.getByTestId("podium-prob");
  expect(await probs.count()).toBeGreaterThanOrEqual(3);
  const texts = await probs.allInnerTexts();
  const percentages = texts.map((t) => Number.parseInt(t.replace(/[^\d]/g, ""), 10));
  const sorted = [...percentages].sort((a, b) => b - a);
  expect(percentages).toEqual(sorted);

  // AC-5: clicking the top card expands its SHAP + Bedrock explanation.
  const top = probs.first().locator("xpath=ancestor::button");
  await expect(top).toHaveAttribute("aria-expanded", "false");
  await top.click();
  await expect(top).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/Souveräne Pole-Position/)).toBeVisible();
});
