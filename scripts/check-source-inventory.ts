import { execFile } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { pathExists } from "node-base/fs";
import {
  parseSourceInventory,
  type SourceInventory,
  type SourceInventoryComponent,
} from "platform-contracts/source-inventory";
import { duplicateValues } from "ts-base/collections";
import { errorMessage } from "ts-base/errors";
import { compareStrings } from "ts-base/strings";
import { parse } from "yaml";

const INVENTORY_PATH =
  "ui/content/projects/personal-engineering-platform/source-inventory.yaml";
const execFileAsync = promisify(execFile);
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".terraform",
  ".venv",
  "build",
  "coverage",
  "node_modules",
  "out",
]);

interface ProfileDeclaration {
  project?: { id?: string };
  components?: Array<{ id?: string }>;
}

interface ReceiptDeclaration {
  blueprint?: {
    project?: { id?: string };
    components?: Array<{ stable_id?: string; path?: string }>;
  };
}

interface PathClaim {
  path: string;
  owner: string;
  kind: "component" | "exclusion";
}

export interface AdoptionBatch {
  id: string;
  components: Array<{
    id: string;
    project: string;
    paths: string[];
    toolchains: string[];
    profile: SourceInventoryComponent["profile"];
  }>;
}

function extractMiseConfigRoots(source: string): string[] {
  const monorepo = /\[monorepo\]([\s\S]*?)(?:\n\[|$)/.exec(source)?.[1];
  const list = /config_roots\s*=\s*\[([\s\S]*?)\]/.exec(monorepo ?? "")?.[1];
  if (!list) return [];
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function pathContains(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

async function filesBelow(
  repositoryRoot: string,
  relativePath: string,
): Promise<string[]> {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const details = await lstat(absolutePath);
  if (!details.isDirectory()) return [relativePath];
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const childPath = path.posix.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        return IGNORED_DIRECTORY_NAMES.has(entry.name)
          ? []
          : filesBelow(repositoryRoot, childPath);
      }
      return [childPath];
    }),
  );
  return files.flat();
}

async function maintainedFilesBelow(
  repositoryRoot: string,
  roots: string[],
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    return stdout
      .split("\0")
      .filter(Boolean)
      .filter((file) => roots.some((root) => pathContains(root, file)));
  } catch {
    return (
      await Promise.all(roots.map((root) => filesBelow(repositoryRoot, root)))
    ).flat();
  }
}

function claimsFor(inventory: SourceInventory): PathClaim[] {
  return [
    ...inventory.components.flatMap((component) =>
      component.paths.map((componentPath) => ({
        path: componentPath,
        owner: component.id,
        kind: "component" as const,
      })),
    ),
    ...inventory.exclusions.map((exclusion) => ({
      path: exclusion.path,
      owner: exclusion.reason,
      kind: "exclusion" as const,
    })),
  ];
}

function validateAdoption(component: SourceInventoryComponent): string[] {
  if (component.adoption.state === "managed" && component.receipt === null) {
    return [`Managed component '${component.id}' has no Copier receipt`];
  }
  if (component.adoption.state !== "managed" && component.receipt !== null) {
    return [
      `${component.adoption.state} component '${component.id}' cannot claim Copier receipt coverage`,
    ];
  }
  return [];
}

function validateClaimStructure(
  inventory: SourceInventory,
  claims: PathClaim[],
): string[] {
  const issues = duplicateValues(inventory.components.map(({ id }) => id)).map(
    (duplicate) => `Duplicate component ID '${duplicate}'`,
  );
  issues.push(
    ...duplicateValues(inventory.additional_roots).map(
      (duplicate) => `Duplicate additional root '${duplicate}'`,
    ),
  );

  for (const component of inventory.components) {
    const expectedPrefix = `${component.project.replace(/^project:/, "component:")}/`;
    if (!component.id.startsWith(expectedPrefix)) {
      issues.push(
        `Component '${component.id}' is not owned by '${component.project}'`,
      );
    }
    issues.push(
      ...duplicateValues(component.paths).map(
        (duplicate) =>
          `Component '${component.id}' repeats path '${duplicate}'`,
      ),
      ...duplicateValues(component.toolchains).map(
        (duplicate) =>
          `Component '${component.id}' repeats toolchain '${duplicate}'`,
      ),
      ...validateAdoption(component),
    );
  }

  for (const [index, left] of claims.entries()) {
    for (const right of claims.slice(index + 1)) {
      if (
        pathContains(left.path, right.path) ||
        pathContains(right.path, left.path)
      ) {
        issues.push(
          `Overlapping source claims '${left.path}' (${left.owner}) and '${right.path}' (${right.owner})`,
        );
      }
    }
  }
  return issues;
}

async function loadYaml<T>(repositoryRoot: string, relativePath: string): Promise<T> {
  return parse(
    await readFile(path.join(repositoryRoot, relativePath), "utf8"),
  ) as T;
}

async function validateProfileCoverage(
  repositoryRoot: string,
  component: SourceInventoryComponent,
): Promise<string[]> {
  if (component.profile === null) return [];
  if (!(await pathExists(path.join(repositoryRoot, component.profile.path)))) {
    return [
      `Component '${component.id}' references missing profile '${component.profile.path}'`,
    ];
  }
  const profile = await loadYaml<ProfileDeclaration>(
    repositoryRoot,
    component.profile.path,
  );
  const expectedProject = component.project.replace(/^project:/, "");
  const issues: string[] = [];
  if (profile.project?.id !== expectedProject) {
    issues.push(
      `Profile '${component.profile.path}' does not declare project '${expectedProject}'`,
    );
  }
  if (
    !profile.components?.some(
      ({ id }) => id === component.profile?.component_id,
    )
  ) {
    issues.push(
      `Profile '${component.profile.path}' does not declare component '${component.profile.component_id}'`,
    );
  }
  return issues;
}

async function validateReceiptCoverage(
  repositoryRoot: string,
  component: SourceInventoryComponent,
): Promise<string[]> {
  if (component.receipt === null) return [];
  if (!(await pathExists(path.join(repositoryRoot, component.receipt.path)))) {
    return [
      `Component '${component.id}' references missing receipt '${component.receipt.path}'`,
    ];
  }
  const receipt = await loadYaml<ReceiptDeclaration>(
    repositoryRoot,
    component.receipt.path,
  );
  const expectedProject = component.project.replace(/^project:/, "");
  const issues: string[] = [];
  if (receipt.blueprint?.project?.id !== expectedProject) {
    issues.push(
      `Receipt '${component.receipt.path}' does not declare project '${expectedProject}'`,
    );
  }
  const recorded = receipt.blueprint?.components?.find(
    ({ stable_id }) => stable_id === component.id,
  );
  if (!recorded) {
    issues.push(
      `Receipt '${component.receipt.path}' does not declare stable component '${component.id}'`,
    );
  } else if (!recorded.path || !component.paths.includes(recorded.path)) {
    issues.push(
      `Receipt '${component.receipt.path}' records '${component.id}' outside its inventory paths`,
    );
  }
  return issues;
}

async function validateClaimsExist(
  repositoryRoot: string,
  claims: PathClaim[],
): Promise<string[]> {
  const checks = await Promise.all(
    claims.map(async (claim) =>
      (await pathExists(path.join(repositoryRoot, claim.path)))
        ? null
        : `${claim.kind === "component" ? "Source" : "Excluded"} path '${claim.path}' does not exist`,
    ),
  );
  return checks.filter((issue): issue is string => issue !== null);
}

async function validateProjectOwners(
  repositoryRoot: string,
  inventory: SourceInventory,
): Promise<string[]> {
  const projects = [...new Set(inventory.components.map(({ project }) => project))];
  const checks = await Promise.all(
    projects.map(async (projectId) => {
      const slug = projectId.replace(/^project:/, "");
      const indexPath = `ui/content/projects/${slug}/index.mdx`;
      return (await pathExists(path.join(repositoryRoot, indexPath)))
        ? null
        : `Owner '${projectId}' has no project index at '${indexPath}'`;
    }),
  );
  return checks.filter((issue): issue is string => issue !== null);
}

async function validateCoverage(
  repositoryRoot: string,
  inventory: SourceInventory,
  claims: PathClaim[],
): Promise<string[]> {
  const miseSource = await readFile(path.join(repositoryRoot, ".mise.toml"), "utf8");
  const miseRoots = extractMiseConfigRoots(miseSource);
  const coverageRoots = [
    ...new Set([...miseRoots, ...inventory.additional_roots]),
  ].sort(compareStrings);
  const missingRoots = (
    await Promise.all(
      coverageRoots.map(async (root) =>
        (await pathExists(path.join(repositoryRoot, root)))
          ? null
          : `Coverage root '${root}' does not exist`,
      ),
    )
  ).filter((issue): issue is string => issue !== null);
  if (missingRoots.length > 0) return missingRoots;

  const files = [
    ...new Set(await maintainedFilesBelow(repositoryRoot, coverageRoots)),
  ].sort(compareStrings);
  const issues: string[] = [];
  for (const file of files) {
    const matches = claims.filter((claim) => pathContains(claim.path, file));
    if (matches.length === 0) {
      issues.push(`Maintained file '${file}' has no source inventory owner`);
    } else if (matches.length > 1) {
      issues.push(
        `Maintained file '${file}' has multiple source inventory owners: ${matches.map(({ owner }) => owner).join(", ")}`,
      );
    }
  }
  return issues;
}

export function buildAdoptionBatches(
  inventory: SourceInventory,
): AdoptionBatch[] {
  const batches = new Map<string, AdoptionBatch["components"]>();
  for (const component of inventory.components) {
    if (component.adoption.state !== "planned" || !component.adoption.batch) {
      continue;
    }
    const entries = batches.get(component.adoption.batch) ?? [];
    entries.push({
      id: component.id,
      project: component.project,
      paths: [...component.paths],
      toolchains: [...component.toolchains],
      profile: component.profile,
    });
    batches.set(component.adoption.batch, entries);
  }
  return [...batches]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([id, components]) => ({
      id,
      components: components.sort((left, right) =>
        compareStrings(left.id, right.id),
      ),
    }));
}

export async function loadSourceInventory(
  repositoryRoot: string,
): Promise<SourceInventory> {
  return parseSourceInventory(
    await loadYaml(repositoryRoot, INVENTORY_PATH),
  );
}

export async function validateSourceInventory(
  repositoryRoot: string,
  inventory: SourceInventory,
): Promise<string[]> {
  const claims = claimsFor(inventory);
  const checks = await Promise.all([
    validateClaimsExist(repositoryRoot, claims),
    validateProjectOwners(repositoryRoot, inventory),
    validateCoverage(repositoryRoot, inventory, claims),
    Promise.all(
      inventory.components.map((component) =>
        validateProfileCoverage(repositoryRoot, component),
      ),
    ).then((issues) => issues.flat()),
    Promise.all(
      inventory.components.map((component) =>
        validateReceiptCoverage(repositoryRoot, component),
      ),
    ).then((issues) => issues.flat()),
  ]);
  return [...validateClaimStructure(inventory, claims), ...checks.flat()].sort(
    compareStrings,
  );
}

async function main(): Promise<void> {
  try {
    const repositoryRoot = process.cwd();
    const inventory = await loadSourceInventory(repositoryRoot);
    const issues = await validateSourceInventory(repositoryRoot, inventory);
    if (issues.length > 0) {
      for (const issue of issues) console.error(`source-inventory: ${issue}`);
      process.exitCode = 1;
      return;
    }
    if (process.argv.includes("--batches")) {
      console.log(JSON.stringify(buildAdoptionBatches(inventory), null, 2));
      return;
    }
    console.log(
      `Source inventory is valid: ${inventory.components.length} components, ${buildAdoptionBatches(inventory).length} adoption batches.`,
    );
  } catch (error) {
    console.error(
      `source-inventory: ${errorMessage(error, "Source inventory validation failed")}`,
    );
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
