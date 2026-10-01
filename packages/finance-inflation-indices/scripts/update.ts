import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArtifacts } from "../src/build";
import { ingestInflationRelease } from "../src/index";
import {
  fetchOnsInflationRelease,
  ONS_INFLATION_SOURCES,
} from "../src/ons";
import { InflationDatasetSchema } from "../src/schema";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataModulePath = resolve(packageRoot, "src/data.ts");
const artifactPattern = /artifacts\/releases\/(\d{4}\.\d{2}\.\d+)\.json/;

const nextDatasetVersion = (current: string, releasedAt: string) => {
  const prefix = releasedAt.slice(0, 7).replace("-", ".");
  const [currentYear, currentMonth, currentPatch] = current.split(".");
  return `${prefix}.${
    `${currentYear}.${currentMonth}` === prefix ? Number(currentPatch) + 1 : 0
  }`;
};

async function main(): Promise<void> {
  const dataModule = await readFile(dataModulePath, "utf8");
  const currentVersion = artifactPattern.exec(dataModule)?.[1];
  if (currentVersion == null) {
    throw new Error("Could not find the current inflation artifact in src/data.ts");
  }
  const currentPath = resolve(
    packageRoot,
    `artifacts/releases/${currentVersion}.json`,
  );
  const current = InflationDatasetSchema.parse(
    JSON.parse(await readFile(currentPath, "utf8")),
  );
  const retrievedAt = new Date().toISOString();
  const fetched = await Promise.all(
    ONS_INFLATION_SOURCES.map((source) =>
      fetchOnsInflationRelease(source, { retrievedAt }),
    ),
  );
  const archive = fetched.reduce(
    (existing, release) => ingestInflationRelease(existing, release),
    { releases: current.releases },
  );

  if (archive.releases.length === current.releases.length) {
    process.stdout.write("ONS inflation archive is already current.\n");
    return;
  }

  const releasedAt = retrievedAt.slice(0, 10);
  const datasetVersion = nextDatasetVersion(current.datasetVersion, releasedAt);
  const updated = InflationDatasetSchema.parse({
    ...current,
    datasetVersion,
    releasedAt,
    supersedes: current.datasetVersion,
    corrections: [],
    releases: archive.releases,
  });
  const generated = buildArtifacts(packageRoot, updated);
  await Promise.all(
    Array.from(generated, async ([relativePath, content]) => {
      const outputPath = resolve(packageRoot, relativePath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content);
    }),
  );
  await writeFile(
    dataModulePath,
    dataModule.replace(
      artifactPattern,
      `artifacts/releases/${datasetVersion}.json`,
    ),
  );
  process.stdout.write(
    `Stored ${archive.releases.length - current.releases.length} ONS inflation release(s) in dataset ${datasetVersion}.\n`,
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
