import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CliError, EXIT_CODES, usageError } from "./errors.js";

const repositoryMarkers = [
  ".mise.toml",
  "packages/work-graph-cli/package.json",
  "packages/work-graph-cli/mise.toml",
] as const;

export interface SelfUpdateResult {
  sourceDirectory: string;
  status: "updated";
}

export type SelfUpdater = (sourceDirectory: string) => SelfUpdateResult;

interface InstallerResult {
  error?: Error;
  status: number | null;
  stderr: string;
  stdout?: string;
}

interface SelfUpdateDependencies {
  pathExists?: (path: string) => boolean;
  runInstaller?: (repositoryRoot: string) => InstallerResult;
}

export const findRepositoryRoot = (
  sourceDirectory: string,
  pathExists: (path: string) => boolean = existsSync,
): string | undefined => {
  let candidate = resolve(sourceDirectory);

  while (true) {
    if (repositoryMarkers.every((marker) => pathExists(join(candidate, marker)))) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
};

export const updateFromCheckout = (
  sourceDirectory: string,
  dependencies: SelfUpdateDependencies = {},
): SelfUpdateResult => {
  const repositoryRoot = findRepositoryRoot(
    sourceDirectory,
    dependencies.pathExists,
  );
  if (repositoryRoot === undefined) {
    throw usageError(
      `No Work Graph source checkout was found from ${resolve(sourceDirectory)}. Run this command inside the repository or pass --source-directory.`,
    );
  }

  const child =
    dependencies.runInstaller?.(repositoryRoot) ??
    spawnSync("mise", ["//packages/work-graph-cli:install:global"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

  if (child.error !== undefined || child.status !== 0) {
    const detail =
      child.error?.message ??
      (child.stderr.trim() || child.stdout?.trim() || "unknown error");
    throw new CliError(
      "SELF_UPDATE_FAILED",
      `Failed to install the Work Graph CLI: ${detail}`,
      EXIT_CODES.transport,
      { cause: child.error },
    );
  }

  return { sourceDirectory: repositoryRoot, status: "updated" };
};
