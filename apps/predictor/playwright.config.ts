import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke-test config (Constitution X — one E2E per frontend).
 *
 * Default: spin up `next dev` locally with no NEXT_PUBLIC_PREDICTIONS_API_URL,
 * so the predictor renders seeded demo data and the smoke is deterministic
 * without a backend. Against a deployed preview, set BASE_URL to skip the
 * local server:
 *   BASE_URL=https://<preview>.vercel.app pnpm -F @f1/predictor test:e2e
 */
const baseURL = process.env["BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env["CI"] ? 1 : 0,
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(process.env["BASE_URL"]
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
