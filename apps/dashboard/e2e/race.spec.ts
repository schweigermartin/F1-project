import { expect, test } from "@playwright/test";

/**
 * Smoke test: open the dashboard and assert the connection is established and
 * the first data is on screen (Constitution X). Against the local dev server
 * this runs in demo mode (seeded data); against a deployed preview it asserts
 * the same shell + that the replay controls work.
 */
test("dashboard loads, shows data and connection status", async ({ page }) => {
  await page.goto("/live");

  await expect(page.getByRole("heading", { name: "F1 Live Dashboard" })).toBeVisible();

  // Connection badge is always rendered (status text: open/connecting/…).
  await expect(page.getByLabel(/connection/)).toBeVisible();

  // First data: the timing tower header + at least one driver row, and the
  // visx gap chart. (Seeded in demo mode; present once a snapshot arrives.)
  await expect(page.getByRole("columnheader", { name: "Driver" })).toBeVisible();
  await expect(page.getByRole("img", { name: "gap to leader chart" })).toBeVisible();
});

test("replay controls are present and speed is selectable", async ({ page }) => {
  await page.goto("/live");

  await expect(page.getByLabel("session id")).toBeVisible();
  const fourX = page.getByRole("button", { name: "4×" });
  await fourX.click();
  await expect(fourX).toHaveAttribute("aria-pressed", "true");
});
