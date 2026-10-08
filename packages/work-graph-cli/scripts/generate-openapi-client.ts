import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@hey-api/openapi-ts";
import { workGraphOpenApiConfig } from "../openapi-ts.config.js";

const generatedDirectory = fileURLToPath(
  new URL("../src/generated/client", import.meta.url),
);

const filesIn = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesIn(path) : [path];
    }),
  );
  return files
    .flat()
    .sort((left, right) => left.localeCompare(right));
};

const snapshots = async (directory: string): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  for (const path of await filesIn(directory)) {
    result.set(relative(directory, path), await readFile(path, "utf8"));
  }
  return result;
};

const checkGeneratedClient = async (): Promise<void> => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "work-graph-openapi-"));
  const temporaryOutput = join(temporaryRoot, "client");
  try {
    await createClient(await workGraphOpenApiConfig(temporaryOutput));
    const [expected, actual] = await Promise.all([
      snapshots(temporaryOutput),
      snapshots(generatedDirectory),
    ]);
    const paths = new Set([...expected.keys(), ...actual.keys()]);
    const changed = [...paths]
      .filter((path) => expected.get(path) !== actual.get(path))
      .sort((left, right) => left.localeCompare(right));
    if (changed.length > 0) {
      throw new Error(
        [
          "Generated Work Graph client is out of sync with openapi.json.",
          "Run `mise //packages/work-graph-cli:openapi:generate` and commit:",
          ...changed.map((path) => `  ${path}`),
        ].join("\n"),
      );
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
};

if (process.argv.includes("--check")) {
  await checkGeneratedClient();
} else {
  await createClient(await workGraphOpenApiConfig(generatedDirectory));
}
