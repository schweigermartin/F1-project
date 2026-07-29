import { configDefaults, defineConfig } from "vitest/config";

/**
 * CDK bundles the infra source — including `__tests__/**` — into Lambda code
 * assets under `cdk.out/`. Without this exclude, vitest's default `**` glob
 * discovers those duplicated `*.test.ts` copies and runs many parallel copies
 * of the synth-heavy stack tests at once, which just times out. `cdk.out` is
 * build output (gitignored); it is never a test source.
 */
/**
 * The stack tests memoize their `Template`, so exactly one test per file pays
 * the full CDK synth — on a CI runner that single call measured 5.4s, just over
 * vitest's 5s default, which failed the run while every other test finished in
 * milliseconds. The tests are not hanging; a synth is genuinely that expensive.
 * Raising the ceiling fits the work rather than the other way round, and a
 * real hang still fails well inside a CI job's own limit.
 */
const SYNTH_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "cdk.out/**"],
    testTimeout: SYNTH_TIMEOUT_MS,
    hookTimeout: SYNTH_TIMEOUT_MS,
  },
});
