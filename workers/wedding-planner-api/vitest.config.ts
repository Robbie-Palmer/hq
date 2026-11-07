import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));

export default {
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: [
        "text",
        ["lcovonly", { projectRoot: path.resolve(packageDirectory, "../..") }],
      ],
      reportsDirectory: path.resolve(packageDirectory, "coverage"),
    },
  },
};
