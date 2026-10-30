import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeJson } from "../url-import-corpus/corpus.js";
import {
  evaluateBaselineWithCache,
} from "../url-import-baseline/evaluate.js";
import {
  evaluateRegressionGate,
  loadRegressionConfig,
} from "../url-import-baseline/gate.js";
import { valueAfter } from "./cli-arguments.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REPOSITORY_ROOT = path.resolve(PROJECT_ROOT, "../..");

function resolvedArgument(
  argv: string[],
  flag: string,
  fallback: string,
): string {
  return path.resolve(PROJECT_ROOT, valueAfter(argv, flag) ?? fallback);
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const corpusRoot = resolvedArgument(
    argv,
    "--corpus",
    "data/url-import-corpus/synthetic/v1",
  );
  const configFile = resolvedArgument(
    argv,
    "--config",
    "config/url-import-deterministic-baseline.json",
  );
  const reportFile = resolvedArgument(
    argv,
    "--report",
    "outputs/url-import-deterministic-baseline.json",
  );
  const failuresFile = resolvedArgument(
    argv,
    "--failures",
    "outputs/url-import-deterministic-failures.json",
  );
  const gateFile = resolvedArgument(
    argv,
    "--gate",
    "outputs/url-import-regression-gate.json",
  );
  const cacheFile = resolvedArgument(
    argv,
    "--cache",
    "outputs/url-import-deterministic-baseline-cache.json",
  );

  const evaluation = await evaluateBaselineWithCache({
    root: REPOSITORY_ROOT,
    corpusRoot,
    cacheFile,
    dependencyEntries: [
      configFile,
      path.join(PROJECT_ROOT, "src/url-import-baseline"),
      path.join(PROJECT_ROOT, "src/url-import-corpus/corpus.ts"),
      path.join(PROJECT_ROOT, "src/url-import-corpus/schema.ts"),
      fileURLToPath(import.meta.url),
      path.join(REPOSITORY_ROOT, "packages/recipe-parsing/src"),
      path.join(REPOSITORY_ROOT, "packages/recipe-domain/src"),
      path.join(REPOSITORY_ROOT, "packages/ts-base/src"),
      path.join(REPOSITORY_ROOT, "pnpm-lock.yaml"),
    ],
  });
  const config = loadRegressionConfig(configFile);
  const gate = evaluateRegressionGate(evaluation.report, config);

  writeJson(reportFile, evaluation.report);
  writeJson(failuresFile, evaluation.failures);
  writeJson(gateFile, gate);
  if (!gate.passed) {
    throw new Error(
      `URL-import baseline exceeded ${gate.violations.length} regression budget(s)`,
    );
  }
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  await main();
}
