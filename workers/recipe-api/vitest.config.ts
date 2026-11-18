import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "cedar-policy-text",
      transform(source, id) {
        if (!id.endsWith(".cedar")) return undefined;
        return { code: `export default ${JSON.stringify(source)}`, map: null };
      },
    },
  ],
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", ["lcovonly", { projectRoot: "../.." }]],
      reportsDirectory: "coverage",
    },
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    globals: true,
  },
});
