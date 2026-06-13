import { expect, test } from "@playwright/test";

/**
 * Season Explorer smoke (Phase 8, Constitution X). Asserts the selector shell
 * and the URL-driven interactions. Structural assertions (headings, selectors,
 * URL params) keep it robust against the live Jolpica/OpenF1 data the landing
 * uses — CI runs vitest only, this runs locally / against a preview.
 */
test("season explorer: selectors drive the URL", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Season Explorer");

  // The sticky selector bar with all three controls.
  await expect(page.getByLabel("Rennen wählen")).toBeVisible();
  await expect(page.getByLabel("Fahrer fokussieren")).toBeVisible();
  await expect(page.getByRole("button", { name: "Qualifying" })).toBeVisible();

  // Session selector writes ?session= and updates the board heading.
  await page.getByRole("button", { name: "Qualifying", exact: true }).click();
  await expect(page).toHaveURL(/session=qualifying/);
  await page.getByRole("button", { name: "FP1", exact: true }).click();
  await expect(page).toHaveURL(/session=fp1/);

  // Driver focus writes ?driver= when a driver is available.
  const focus = page.getByLabel("Fahrer fokussieren");
  const optionCount = await focus.locator("option").count();
  if (optionCount > 1) {
    await focus.selectOption({ index: 1 });
    await expect(page).toHaveURL(/driver=/);
  }
});
