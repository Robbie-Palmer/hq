import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  root: "../..",
  test: {
    coverage: {
      provider: "v8",
      allowExternal: true,
      include: [
        "workers/recipe-api/src/**/*.ts",
        "packages/recipe-db/src/batch-drafts.ts",
      ],
      reporter: [["lcovonly", { projectRoot: "../.." }]],
      reportsDirectory: "workers/recipe-api/coverage-integration",
    },
    exclude: configDefaults.exclude,
    fileParallelism: false,
    globals: true,
    hookTimeout: 30_000,
    include: ["workers/recipe-api/tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
