import { defineConfig, devices } from "@playwright/test";

const port = 8793;

export default defineConfig({
  testDir: "./e2e/mermaid",
  failOnFlakyTests: Boolean(process.env.CI),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results/mermaid",
  webServer: {
    command: `pnpm exec serve out --listen tcp://127.0.0.1:${port} --no-clipboard --no-port-switching --no-request-logging`,
    url: `http://127.0.0.1:${port}/technologies/mermaid`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    actionTimeout: 10_000,
    baseURL: `http://127.0.0.1:${port}`,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
