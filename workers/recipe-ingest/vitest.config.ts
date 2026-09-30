import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      allowExternal: true,
      include: [
        "src/**/*.ts",
        "../../packages/recipe-db/src/index.ts",
        "../../packages/recipe-domain/src/import-storage.ts",
      ],
      provider: "v8",
      reporter: ["text", ["lcovonly", { projectRoot: "../.." }]],
      reportsDirectory: "coverage",
    },
    globals: true,
  },
});
