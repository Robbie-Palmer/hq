import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: [
        "text",
        ["lcovonly", { projectRoot: path.resolve(packageDirectory, "../..") }],
      ],
      reportsDirectory: path.resolve(packageDirectory, "coverage"),
    },
    exclude: configDefaults.exclude,
    fileParallelism: false,
    globals: true,
    hookTimeout: 30_000,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
