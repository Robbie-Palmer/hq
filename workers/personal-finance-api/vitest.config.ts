import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "cedar-policy-text",
      transform(source, id) {
        if (!id.endsWith(".cedar")) return undefined;
        return `export default ${JSON.stringify(source)};`;
      },
    },
  ],
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcovonly"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
