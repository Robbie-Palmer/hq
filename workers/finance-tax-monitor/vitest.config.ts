import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    coverage: {
      allowExternal: true,
      include: [
        "src/**/*.ts",
        "../../packages/finance-tax-rules/src/govUkMonitor.ts",
      ],
      provider: "v8",
      reporter: ["text", ["lcovonly", { projectRoot: "../.." }]],
      reportsDirectory: "coverage",
    },
  },
});
