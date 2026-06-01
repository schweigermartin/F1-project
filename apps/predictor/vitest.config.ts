import react from "@vitejs/plugin-react-oxc";
import { configDefaults, defineConfig } from "vitest/config";

// jsdom + the React plugin so the component tests can render JSX; e2e/** is the
// Playwright suite (run via `pnpm test:e2e`), not vitest.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**", ".next/**"],
  },
});
