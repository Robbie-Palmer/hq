import path from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const coverageEnabled = process.env.UI_COVERAGE === "true";

export default defineConfig({
  root: coverageEnabled ? path.resolve(__dirname, "..") : undefined,
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    ...(coverageEnabled
      ? {
          include: [
            "ui/features/**/tests/**/*.{test,spec}.{ts,tsx}",
            "ui/tests/**/*.{test,spec}.{ts,tsx}",
          ],
        }
      : {}),
    coverage: {
      provider: "v8",
      reporter: ["text", ["lcovonly", { projectRoot: ".." }]],
      reportsDirectory: path.resolve(__dirname, "coverage"),
    },
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "tests/setup.ts")],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
