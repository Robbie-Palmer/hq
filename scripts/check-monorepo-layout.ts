import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pathExists } from "node-base/fs";
import {
  parseRepositoryLayoutContract,
  type RepositoryLayoutComponentKind as ComponentKind,
  type RepositoryLayoutContract as LayoutContract,
  type RepositoryLayoutNamedRecord as NamedRecord,
  type RepositoryLayoutSharedManifest as SharedManifest,
} from "platform-contracts/repository-layout";
import { duplicateValues, setsEqual } from "ts-base/collections";
import { errorMessage } from "ts-base/errors";
import { compareStrings } from "ts-base/strings";
import { parse } from "yaml";

const CONTRACT_PATH =
  "ui/content/projects/personal-engineering-platform/repository-layout.yaml";
const PLATFORM_MANIFEST_PATH =
  "ui/content/projects/personal-engineering-platform/platform.yaml";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DECISION_FILE_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*\.mdx$/;
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
const IGNORED_DIRECTORY_PATHS = new Set(["ui/public/cesium"]);
const REQUIRED_TASKS = new Set([
  "install",
  "format",
  "lint",
  "typecheck-or-compile",
  "test",
  "build",
  "clean",
]);
const SHARED_MANIFEST_BOUNDARY = new Map([
  [CONTRACT_PATH, ["projects"]],
  [".mise.toml", ["monorepo.config_roots"]],
  ["pnpm-workspace.yaml", ["packages"]],
  [PLATFORM_MANIFEST_PATH, ["catalog.records"]],
]);

interface CatalogRecordDeclaration {
  id?: string;
  kind?: string;
  project?: string;
  source_paths?: string[];
}

export function parseLayoutContract(value: unknown): LayoutContract {
  return parseRepositoryLayoutContract(value);
}

export async function loadLayoutContract(
  repositoryRoot: string,
): Promise<LayoutContract> {
  const source = await readFile(path.join(repositoryRoot, CONTRACT_PATH), "utf8");
  return parseLayoutContract(parse(source));
}

function validateNamedRecords(
  label: string,
  records: NamedRecord[] | undefined,
): string[] {
  if (!Array.isArray(records) || records.length === 0) {
    return [`The contract must declare at least one ${label}`];
  }
  const issues = records
    .filter((record) => !SLUG_PATTERN.test(record.id))
    .map((record) => `Invalid ${label} ID '${record.id}'`);
  issues.push(
    ...duplicateValues(records.map(({ id }) => id)).map(
      (duplicate) => `Duplicate ${label} ID '${duplicate}'`,
    ),
  );
  return issues;
}

function validateComponentPaths(components: ComponentKind[]): string[] {
  const issues: string[] = [];
  for (const component of components) {
    if (
      component.directory.startsWith("/") ||
      component.directory.split("/").includes("..")
    ) {
      issues.push(`Component path '${component.directory}' must be repository-relative`);
    }
    const placeholders = component.directory
      .split("{")
      .slice(1)
      .map((segment) => `{${segment.split("}")[0]}}`);
    if (
      placeholders.some(
        (placeholder) =>
          placeholder !== "{component}" && placeholder !== "{project}",
      )
    ) {
      issues.push(`Component path '${component.directory}' has an unknown placeholder`);
    }
    if (!component.mise_config_root && !component.delegated_task_project) {
      issues.push(
        `Component kind '${component.id}' without a mise root must delegate its tasks`,
      );
    }
    if (component.mise_config_root && component.delegated_task_project) {
      issues.push(
        `Component kind '${component.id}' cannot own and delegate its mise tasks`,
      );
    }
  }
  issues.push(
    ...duplicateValues(components.map(({ directory }) => directory)).map(
      (duplicate) => `Duplicate component path '${duplicate}'`,
    ),
  );
  return issues;
}

function validateProjectRegistrationContract(
  contract: LayoutContract,
): string[] {
  const projects = contract.projects ?? [];
  const projectKinds = new Set(
    (contract.project_kinds ?? []).map(({ id }) => id),
  );
  const issues = validateNamedRecords("project registration", projects);
  for (const project of projects) {
    if (!projectKinds.has(project.kind)) {
      issues.push(
        `Project '${project.id}' uses unknown project kind '${project.kind}'`,
      );
    }
    if (!project.catalog_record.startsWith(`system:${project.id}/`)) {
      issues.push(
        `Project '${project.id}' must reference one of its system catalog records`,
      );
    }
  }
  issues.push(
    ...duplicateValues(projects.map(({ catalog_record }) => catalog_record)).map(
      (duplicate) => `Duplicate project catalog record '${duplicate}'`,
    ),
  );
  return issues;
}

function validateKnowledgeGraphTemplates(
  knowledgeGraph: LayoutContract["knowledge_graph"],
): string[] {
  const templates = [
    ["project index", knowledgeGraph?.project_index, ["{project}"]],
    [
      "architecture decision",
      knowledgeGraph?.architecture_decisions,
      ["{project}", "{sequence}", "{slug}"],
    ],
    [
      "product decision",
      knowledgeGraph?.product_decisions,
      ["{project}", "{sequence}", "{slug}"],
    ],
  ] as const;
  const issues: string[] = [];
  for (const [label, template, placeholders] of templates) {
    if (
      !template ||
      template.startsWith("/") ||
      template.split("/").includes("..")
    ) {
      issues.push(`The ${label} path must be repository-relative`);
      continue;
    }
    if (placeholders.some((placeholder) => !template.includes(placeholder))) {
      issues.push(`The ${label} path is missing a required placeholder`);
    }
  }
  return issues;
}

function validateTaskContract(tasks: string[]): string[] {
  const issues: string[] = [];
  if (!setsEqual(tasks, REQUIRED_TASKS)) {
    issues.push(
      "The task contract must contain install, format, lint, typecheck-or-compile, test, build, and clean",
    );
  }
  issues.push(
    ...duplicateValues(tasks).map(
      (duplicate) => `Duplicate required task '${duplicate}'`,
    ),
  );
  return issues;
}

function validateSharedManifestBoundary(
  manifests: SharedManifest[],
): string[] {
  const declaredBoundary = new Map(
    manifests.map((entry) => [entry.path, entry.allowed_edits]),
  );
  const boundaryMatches =
    manifests.length === SHARED_MANIFEST_BOUNDARY.size &&
    declaredBoundary.size === SHARED_MANIFEST_BOUNDARY.size &&
    [...SHARED_MANIFEST_BOUNDARY].every(([manifestPath, allowedEdits]) =>
      setsEqual(declaredBoundary.get(manifestPath) ?? [], allowedEdits),
    );
  return boundaryMatches
    ? []
    : [
        "Shared manifest edits must remain limited to project registrations, mise config roots, pnpm packages, and platform catalog records",
      ];
}

export function validateLayoutContract(contract: LayoutContract): string[] {
  const issues: string[] = [];
  if (contract.schema_version !== 1) {
    issues.push(`Unsupported layout schema version '${contract.schema_version}'`);
  }
  issues.push(
    ...validateNamedRecords("project kind", contract.project_kinds),
    ...validateProjectRegistrationContract(contract),
    ...validateNamedRecords("component kind", contract.component_kinds),
    ...validateComponentPaths(contract.component_kinds ?? []),
    ...validateKnowledgeGraphTemplates(contract.knowledge_graph),
  );
  for (const projectKind of contract.project_kinds ?? []) {
    if (projectKind.task_profile !== contract.task_contract?.id) {
      issues.push(
        `Project kind '${projectKind.id}' must use task profile '${contract.task_contract?.id}'`,
      );
    }
  }
  const tasks = contract.task_contract?.required ?? [];
  issues.push(
    ...validateTaskContract(tasks),
    ...validateSharedManifestBoundary(contract.shared_manifests ?? []),
  );
  return issues;
}

async function findFiles(
  root: string,
  fileName: string,
  relativeDirectory = "",
): Promise<string[]> {
  const entries = await readdir(path.join(root, relativeDirectory), {
    withFileTypes: true,
  });
  const discovered = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isFile() && entry.name === fileName) return [relativePath];
      if (
        entry.isDirectory() &&
        !IGNORED_DIRECTORY_NAMES.has(entry.name) &&
        !IGNORED_DIRECTORY_PATHS.has(relativePath)
      ) {
        return findFiles(root, fileName, relativePath);
      }
      return [];
    }),
  );
  return discovered
    .flat()
    .sort(compareStrings);
}

function extractMiseConfigRoots(source: string): string[] {
  const monorepo = /\[monorepo\]([\s\S]*?)(?:\n\[|$)/.exec(source)?.[1];
  const list = /config_roots\s*=\s*\[([\s\S]*?)\]/.exec(monorepo ?? "")?.[1];
  if (!list) return [];
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function workspaceMatches(directory: string, workspacePattern: string): boolean {
  if (workspacePattern.endsWith("/*")) {
    const prefix = workspacePattern.slice(0, -1);
    return (
      directory.startsWith(prefix) &&
      !directory.slice(prefix.length).includes("/")
    );
  }
  return directory === workspacePattern;
}

async function validateMiseRoots(
  repositoryRoot: string,
  contract: LayoutContract,
): Promise<string[]> {
  const issues: string[] = [];
  const miseSource = await readFile(path.join(repositoryRoot, ".mise.toml"), "utf8");
  const configured = extractMiseConfigRoots(miseSource);
  const localRoots = new Set(contract.workspace_policy.local_mise_roots);
  const discovered = (await findFiles(repositoryRoot, "mise.toml"))
    .map((file) => path.posix.dirname(file))
    .filter((directory) => !localRoots.has(directory));

  for (const duplicate of duplicateValues(configured)) {
    issues.push(`Duplicate mise config root '${duplicate}'`);
  }
  for (const missing of configured.filter(
    (directory) => !discovered.includes(directory),
  )) {
    issues.push(`Configured mise root '${missing}' has no mise.toml`);
  }
  for (const unregistered of discovered.filter(
    (directory) => !configured.includes(directory),
  )) {
    issues.push(`mise root '${unregistered}' is not registered in .mise.toml`);
  }
  return issues;
}

async function validateNodeWorkspace(
  repositoryRoot: string,
  contract: LayoutContract,
): Promise<string[]> {
  const issues: string[] = [];
  const policy = contract.workspace_policy;
  const workspace = parse(
    await readFile(path.join(repositoryRoot, policy.node_workspace), "utf8"),
  ) as { packages?: string[] };
  const workspacePatterns = workspace.packages ?? [];
  const standaloneRoots = new Set(policy.standalone_node_roots);
  const packageDirectories = (await findFiles(repositoryRoot, "package.json"))
    .map((file) => path.posix.dirname(file))
    .filter((directory) => directory !== ".");

  for (const directory of packageDirectories) {
    if (
      !standaloneRoots.has(directory) &&
      !workspacePatterns.some((pattern) => workspaceMatches(directory, pattern))
    ) {
      issues.push(`Node package '${directory}' is outside the pnpm workspace`);
    }
  }

  const pnpmLocks = await findFiles(repositoryRoot, "pnpm-lock.yaml");
  if (!setsEqual(pnpmLocks, [policy.node_lockfile])) {
    issues.push(`pnpm lockfiles must be limited to '${policy.node_lockfile}'`);
  }
  const npmLocks = await findFiles(repositoryRoot, "package-lock.json");
  if (!setsEqual(npmLocks, policy.approved_npm_lockfiles)) {
    issues.push("package-lock.json files must match the approved list");
  }
  return issues;
}

async function validatePythonLocks(repositoryRoot: string): Promise<string[]> {
  const manifests = await findFiles(repositoryRoot, "pyproject.toml");
  const issues = await Promise.all(
    manifests.map(async (manifest) => {
      const projectDirectory = path.dirname(manifest);
      const lockfile = path.join(repositoryRoot, projectDirectory, "uv.lock");
      return (await pathExists(lockfile))
        ? null
        : `Python project '${projectDirectory}' has no uv.lock`;
    }),
  );
  return issues.filter((issue): issue is string => issue !== null);
}

async function validateDecisionDirectory(
  projectRoot: string,
  project: string,
  decisionDirectory: string,
): Promise<string[]> {
  const decisionsRoot = path.join(projectRoot, decisionDirectory);
  if (!(await pathExists(decisionsRoot))) return [];
  return (await readdir(decisionsRoot, { withFileTypes: true }))
    .filter(
      (decision) =>
        decision.isFile() && !DECISION_FILE_PATTERN.test(decision.name),
    )
    .map(
      (decision) =>
        `Decision '${project}/${decisionDirectory}/${decision.name}' has an invalid filename`,
    );
}

async function validateKnowledgeGraph(repositoryRoot: string): Promise<string[]> {
  const projectsRoot = path.join(repositoryRoot, "ui/content/projects");
  const projects = await readdir(projectsRoot, { withFileTypes: true });
  const projectIssues = await Promise.all(
    projects
      .filter((entry) => entry.isDirectory())
      .map(async (project) => {
        const projectRoot = path.join(projectsRoot, project.name);
        const [hasIndex, decisionIssues] = await Promise.all([
          pathExists(path.join(projectRoot, "index.mdx")),
          Promise.all(
            ["adrs", "pdrs"].map((decisionDirectory) =>
              validateDecisionDirectory(
                projectRoot,
                project.name,
                decisionDirectory,
              ),
            ),
          ),
        ]);
        return [
          ...(hasIndex ? [] : [`Project '${project.name}' has no index.mdx`]),
          ...decisionIssues.flat(),
        ];
      }),
  );
  return projectIssues.flat();
}

async function loadCatalogRecords(
  repositoryRoot: string,
): Promise<CatalogRecordDeclaration[]> {
  const manifest = parse(
    await readFile(path.join(repositoryRoot, PLATFORM_MANIFEST_PATH), "utf8"),
  ) as { catalog?: { records?: CatalogRecordDeclaration[] } };
  return manifest.catalog?.records ?? [];
}

async function validateCatalogSourcePaths(
  repositoryRoot: string,
  records: CatalogRecordDeclaration[],
): Promise<string[]> {
  const sources = records.flatMap((record) =>
    (record.source_paths ?? []).map((sourcePath) => ({
      recordId: record.id ?? "unknown",
      sourcePath,
    })),
  );
  const issues = await Promise.all(
    sources.map(async ({ recordId, sourcePath }) =>
      (await pathExists(path.join(repositoryRoot, sourcePath)))
        ? null
        : `Catalog record '${recordId}' references missing path '${sourcePath}'`,
    ),
  );
  return issues.filter((issue): issue is string => issue !== null);
}

async function validateRegisteredProjects(
  repositoryRoot: string,
  contract: LayoutContract,
  catalogRecords: CatalogRecordDeclaration[],
): Promise<string[]> {
  const recordsById = new Map(
    catalogRecords.map((record) => [record.id, record]),
  );
  const issues = await Promise.all(
    (contract.projects ?? []).map(async (project) => {
      const projectIssues: string[] = [];
      const projectIndex = contract.knowledge_graph.project_index.replace(
        "{project}",
        project.id,
      );
      if (!(await pathExists(path.join(repositoryRoot, projectIndex)))) {
        projectIssues.push(
          `Registered project '${project.id}' has no project index`,
        );
      }
      const catalogRecord = recordsById.get(project.catalog_record);
      if (!catalogRecord) {
        projectIssues.push(
          `Registered project '${project.id}' references missing catalog record '${project.catalog_record}'`,
        );
        return projectIssues;
      }
      if (
        catalogRecord.kind !== "system" ||
        catalogRecord.project !== `project:${project.id}`
      ) {
        projectIssues.push(
          `Catalog record '${project.catalog_record}' must be a system owned by project:${project.id}`,
        );
      }
      if ((catalogRecord.source_paths ?? []).length === 0) {
        projectIssues.push(
          `Catalog record '${project.catalog_record}' must map the project to at least one source path`,
        );
      }
      return projectIssues;
    }),
  );
  return issues.flat();
}

export async function validateRepositoryLayout(
  repositoryRoot: string,
  contract: LayoutContract,
): Promise<string[]> {
  const issues = validateLayoutContract(contract);
  const catalogRecords = await loadCatalogRecords(repositoryRoot);
  const [componentIssues, manifestIssues, ...checks] = await Promise.all([
    Promise.all(
      (contract.component_kinds ?? []).map(async (component) => {
        const stablePrefix = component.directory
          .split("{")[0]
          .replace(/\/$/, "");
        return stablePrefix &&
          !(await pathExists(path.join(repositoryRoot, stablePrefix)))
          ? `Component directory root '${stablePrefix}' does not exist`
          : null;
      }),
    ),
    Promise.all(
      (contract.shared_manifests ?? []).map(async (manifest) =>
        (await pathExists(path.join(repositoryRoot, manifest.path)))
          ? null
          : `Shared manifest '${manifest.path}' does not exist`,
      ),
    ),
    validateMiseRoots(repositoryRoot, contract),
    validateNodeWorkspace(repositoryRoot, contract),
    validatePythonLocks(repositoryRoot),
    validateKnowledgeGraph(repositoryRoot),
    validateCatalogSourcePaths(repositoryRoot, catalogRecords),
    validateRegisteredProjects(repositoryRoot, contract, catalogRecords),
  ]);
  issues.push(
    ...componentIssues.filter((issue): issue is string => issue !== null),
    ...manifestIssues.filter((issue): issue is string => issue !== null),
    ...checks.flat(),
  );
  return issues.sort(compareStrings);
}

async function main(): Promise<void> {
  try {
    const repositoryRoot = process.cwd();
    const contract = await loadLayoutContract(repositoryRoot);
    const issues = await validateRepositoryLayout(repositoryRoot, contract);
    if (issues.length > 0) {
      for (const issue of issues) console.error(`layout: ${issue}`);
      process.exitCode = 1;
      return;
    }
    console.log("Monorepo layout contract is valid.");
  } catch (error) {
    console.error(`layout: ${errorMessage(error, "Layout validation failed")}`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
