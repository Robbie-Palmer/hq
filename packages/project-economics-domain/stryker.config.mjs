/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/**/*.ts", "!src/index.ts"],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.ts",
  },
  reporters: ["clear-text", "progress", "html", "json"],
  clearTextReporter: {
    reportTests: false,
    reportMutants: false,
    reportScoreTable: true,
  },
  ignoreStatic: true,
  thresholds: {
    break: 71,
  },
  incremental: true,
  incrementalFile: "reports/stryker-logic-incremental.json",
  tempDirName: "../../.stryker-tmp/project-economics-domain",
  cleanTempDir: "always",
};

export default config;
