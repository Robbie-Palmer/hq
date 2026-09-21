import { defineConfig, devices } from "@playwright/test";

const port = 8793;

export default defineConfig({
  testDir: "./e2e/mermaid",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results/mermaid",
  webServer: {
    command: `pnpm exec serve out --listen tcp://127.0.0.1:${port} --no-clipboard --no-port-switching --no-request-logging`,
    url: `http://127.0.0.1:${port}/technologies/mermaid`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
