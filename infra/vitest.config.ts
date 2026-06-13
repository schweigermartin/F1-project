import { configDefaults, defineConfig } from "vitest/config";

/**
 * CDK bundles the infra source — including `__tests__/**` — into Lambda code
 * assets under `cdk.out/`. Without this exclude, vitest's default `**` glob
 * discovers those duplicated `*.test.ts` copies and runs many parallel copies
 * of the synth-heavy stack tests at once, which just times out. `cdk.out` is
 * build output (gitignored); it is never a test source.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "cdk.out/**"],
  },
});
