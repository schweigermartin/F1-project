import { configDefaults, defineConfig } from "vitest/config";

// Keep the Playwright e2e suite (e2e/**) out of the vitest unit run — it uses
// the Playwright runner, not vitest. Run it via `pnpm test:e2e`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", ".next/**"],
  },
});
