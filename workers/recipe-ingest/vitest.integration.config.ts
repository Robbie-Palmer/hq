import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  root: "../..",
  test: {
    exclude: configDefaults.exclude,
    fileParallelism: false,
    globals: true,
    hookTimeout: 30_000,
    include: [
      "workers/recipe-ingest/tests/integration/**/*.test.ts",
    ],
    testTimeout: 30_000,
  },
});
