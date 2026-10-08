import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: configDefaults.exclude,
    fileParallelism: false,
    globals: true,
    hookTimeout: 30_000,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
