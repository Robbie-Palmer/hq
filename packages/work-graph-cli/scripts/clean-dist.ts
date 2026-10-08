import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const distributionDirectory = fileURLToPath(
  new URL("../dist", import.meta.url),
);

await rm(distributionDirectory, { force: true, recursive: true });
