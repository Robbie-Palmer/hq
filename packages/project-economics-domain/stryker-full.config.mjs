import config from "./stryker.config.mjs";

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
const fullConfig = {
  ...config,
  ignoreStatic: false,
  thresholds: {
    break: null,
  },
  incrementalFile: "reports/stryker-full-incremental.json",
  htmlReporter: {
    fileName: "reports/mutation-full/mutation.html",
  },
  jsonReporter: {
    fileName: "reports/mutation-full/mutation.json",
  },
};

export default fullConfig;
