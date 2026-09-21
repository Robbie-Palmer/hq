import { execFileSync } from "node:child_process";
import { relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAllDocuments } from "yaml";

const dependencyGroups = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

// This detector only runs on GitHub's Ubuntu runner. Use the system binary
// directly so repository-controlled PATH entries cannot replace Git.
const gitExecutable = "/usr/bin/git";

type DependencyGroup = (typeof dependencyGroups)[number];
type DependencyValue = string | { specifier?: string; version?: string };
type DependencyContainer = Partial<
  Record<DependencyGroup, Record<string, DependencyValue>>
>;

export type DependencyState = {
  declared?: string;
  resolved?: string;
};

function dependencyValue(
  container: DependencyContainer | undefined,
  dependency: string,
): DependencyValue | undefined {
  for (const group of dependencyGroups) {
    const value = container?.[group]?.[dependency];
    if (value !== undefined) return value;
  }
}

export function dependencyState(
  packageJSON: string,
  lockfileYAML: string,
  importer: string,
  dependency: string,
): DependencyState {
  const manifest = JSON.parse(packageJSON) as DependencyContainer;
  const declared = dependencyValue(manifest, dependency);
  let locked: DependencyValue | undefined;
  for (const document of parseAllDocuments(lockfileYAML)) {
    if (document.errors.length > 0) throw document.errors[0];
    const lockfile = document.toJS() as {
      importers?: Record<string, DependencyContainer>;
    };
    const candidate = dependencyValue(
      lockfile.importers?.[importer],
      dependency,
    );
    if (candidate !== undefined) locked = candidate;
  }

  return {
    declared:
      typeof declared === "string" ? declared : declared?.specifier,
    resolved: typeof locked === "string" ? locked : locked?.version,
  };
}

function fileAtRevision(revision: string, path: string): string {
  return execFileSync(gitExecutable, ["show", `${revision}:${path}`], {
    encoding: "utf8",
  });
}

function validateRevision(revision: string, name: string): void {
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(`${name} must be a full lowercase Git revision`);
  }
}

function main(): void {
  const [dependency, baseRevision, headRevision] = process.argv.slice(2);
  if (!dependency || !baseRevision || !headRevision) {
    throw new Error(
      "usage: dependency-version-changed <dependency> <base-revision> <head-revision>",
    );
  }
  validateRevision(baseRevision, "base revision");
  validateRevision(headRevision, "head revision");

  const repositoryRoot = execFileSync(
    gitExecutable,
    ["rev-parse", "--show-toplevel"],
    { encoding: "utf8" },
  ).trim();
  const importer = relative(repositoryRoot, process.cwd()).split(sep).join("/");
  if (!importer || importer.startsWith("..")) {
    throw new Error("run the detector from a package below the repository root");
  }

  const packagePath = `${importer}/package.json`;
  const stateAt = (revision: string): DependencyState =>
    dependencyState(
      fileAtRevision(revision, packagePath),
      fileAtRevision(revision, "pnpm-lock.yaml"),
      importer,
      dependency,
    );
  const base = stateAt(baseRevision);
  const head = stateAt(headRevision);
  const changed =
    base.declared !== head.declared || base.resolved !== head.resolved;

  console.error(
    `${dependency}: ${base.declared ?? "absent"} (${base.resolved ?? "unresolved"}) -> ${head.declared ?? "absent"} (${head.resolved ?? "unresolved"})`,
  );
  process.stdout.write(String(changed));
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main();
}
