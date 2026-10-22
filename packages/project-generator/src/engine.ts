import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "yaml";
import {
  answersPath,
  type ProjectPlan,
  type SharedManifestEdit,
  type TemplateSource,
} from "./contracts.js";
import {
  applySharedManifestEdits,
  manifestPathForEdit,
  SHARED_MANIFEST_PATHS,
} from "./manifests.js";
import { runCommand } from "./process.js";
import type { ResolvedProjectBlueprint } from "./profile.js";

export type GenerationMode = "plan" | "dry-run" | "create" | "update";
type CopierOperation = "create" | "update";

interface UntrackedFile {
  readonly path: string;
  readonly digest: string;
}

interface RepositorySnapshot {
  readonly head: string;
  readonly trackedPatch: string;
  readonly untrackedFiles: readonly UntrackedFile[];
  readonly fingerprint: string;
}

export interface CheckResult {
  readonly task: string;
  readonly status: "passed";
}

export interface GenerationResult {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly operation: CopierOperation;
  readonly templateId: string;
  readonly templateRevision: string;
  readonly baseRevision: string;
  readonly applied: boolean;
  readonly changedPaths: readonly string[];
  readonly checks: readonly CheckResult[];
  readonly diff: string;
}

export type AdoptionClassification =
  | "matching"
  | "adoptable"
  | "conflicting"
  | "outside_ownership";

export interface AdoptionPath {
  readonly path: string;
  readonly classification: AdoptionClassification;
  readonly disposition:
    | "already_matches"
    | "add_template_file"
    | "preserve_local_file"
    | "review_conflict"
    | "reject_template_file";
}

export interface AdoptionSharedManifestEdit {
  readonly path: string;
  readonly classification: Exclude<
    AdoptionClassification,
    "outside_ownership"
  >;
  readonly edit: SharedManifestEdit;
  readonly error?: string;
}

export interface AdoptionPlanResult {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly baseRevision: string;
  readonly effectiveAt: string;
  readonly template: {
    readonly id: string;
    readonly source: string;
    readonly revision: string;
  };
  readonly resolvedBlueprint: ResolvedProjectBlueprint;
  readonly receipt: {
    readonly path: string;
    readonly classification: "adoptable";
    readonly disposition: "create_after_review";
  };
  readonly readyToAdopt: boolean;
  readonly paths: readonly AdoptionPath[];
  readonly sharedManifestEdits: readonly AdoptionSharedManifestEdit[];
  readonly localExceptions: {
    readonly overrides: readonly ResolvedProjectBlueprint["selections"][number][];
    readonly taskExceptions: readonly {
      readonly componentId: string;
      readonly task: string;
      readonly reason: string;
    }[];
    readonly preservedPaths: readonly string[];
  };
}

function splitNullTerminated(source: string): string[] {
  return source.split("\0").filter(Boolean);
}

async function fileDigest(filePath: string): Promise<string> {
  const details = await lstat(filePath);
  const hash = createHash("sha256");
  hash.update(String(details.mode));
  if (details.isSymbolicLink()) {
    hash.update(await realpath(filePath));
  } else {
    hash.update(await readFile(filePath));
  }
  return hash.digest("hex");
}

async function adoptionDigest(filePath: string): Promise<string> {
  const details = await lstat(filePath);
  const hash = createHash("sha256");
  hash.update(String(details.mode));
  if (details.isSymbolicLink()) {
    hash.update("symlink\0");
    hash.update(await readlink(filePath));
  } else if (details.isDirectory()) {
    hash.update("directory\0");
  } else {
    hash.update("file\0");
    hash.update(await readFile(filePath));
  }
  return hash.digest("hex");
}

async function inventoryFiles(
  root: string,
  relativeRoot = "",
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const absoluteRoot = path.join(root, relativeRoot);
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(absoluteRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return files;
    throw error;
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    files.set(relativeRoot, await adoptionDigest(absoluteRoot));
    return files;
  }
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const inventories = await Promise.all(entries.map(async (entry) => {
    const relativePath = relativeRoot
      ? path.posix.join(relativeRoot, entry.name)
      : entry.name;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      return inventoryFiles(root, relativePath);
    }
    return new Map([
      [relativePath, await adoptionDigest(path.join(root, relativePath))],
    ]);
  }));
  for (const inventory of inventories) {
    for (const item of inventory) files.set(...item);
  }
  return files;
}

async function captureSnapshot(
  repositoryRoot: string,
): Promise<RepositorySnapshot> {
  const [headResult, patchResult, untrackedResult] = await Promise.all([
    runCommand("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
    runCommand("git", [
      "-C",
      repositoryRoot,
      "diff",
      "--binary",
      "--full-index",
      "HEAD",
      "--",
    ]),
    runCommand("git", [
      "-C",
      repositoryRoot,
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]),
  ]);
  const untrackedFiles = await Promise.all(
    splitNullTerminated(untrackedResult.stdout).map(async (relativePath) => ({
      path: relativePath,
      digest: await fileDigest(path.join(repositoryRoot, relativePath)),
    })),
  );
  untrackedFiles.sort((left, right) => left.path.localeCompare(right.path));
  const head = headResult.stdout.trim();
  const fingerprint = createHash("sha256")
    .update(head)
    .update("\0")
    .update(patchResult.stdout)
    .update("\0")
    .update(JSON.stringify(untrackedFiles))
    .digest("hex");
  return {
    head,
    trackedPatch: patchResult.stdout,
    untrackedFiles,
    fingerprint,
  };
}

async function copyUntrackedFiles(
  sourceRoot: string,
  worktreeRoot: string,
  files: readonly UntrackedFile[],
): Promise<void> {
  for (const file of files) {
    const source = path.join(sourceRoot, file.path);
    const destination = path.join(worktreeRoot, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, {
      force: false,
      preserveTimestamps: true,
      recursive: false,
      errorOnExist: true,
    });
  }
}

async function prepareWorktree(
  repositoryRoot: string,
  snapshot: RepositorySnapshot,
  temporaryRoot: string,
): Promise<{ worktreeRoot: string; baseline: string }> {
  const worktreeRoot = path.join(temporaryRoot, "worktree");
  await runCommand("git", [
    "-C",
    repositoryRoot,
    "worktree",
    "add",
    "--detach",
    worktreeRoot,
    snapshot.head,
  ]);
  if (snapshot.trackedPatch) {
    await runCommand(
      "git",
      ["-C", worktreeRoot, "apply", "--binary", "-"],
      { input: snapshot.trackedPatch },
    );
  }
  await copyUntrackedFiles(repositoryRoot, worktreeRoot, snapshot.untrackedFiles);
  await runCommand("git", ["-C", worktreeRoot, "add", "--all"]);
  await runCommand("git", [
    "-C",
    worktreeRoot,
    "-c",
    "user.name=Project Generator",
    "-c",
    "user.email=project-generator@example.invalid",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--no-verify",
    "--allow-empty",
    "--quiet",
    "-m",
    "Project generator input snapshot",
  ]);
  const baseline = (
    await runCommand("git", ["-C", worktreeRoot, "rev-parse", "HEAD"])
  ).stdout.trim();
  return { worktreeRoot, baseline };
}

function resolveOperation(
  mode: GenerationMode,
  receiptExists: boolean,
): CopierOperation {
  if (mode === "create") {
    if (receiptExists) {
      throw new Error("Cannot create project: its Copier answers file already exists");
    }
    return "create";
  }
  if (mode === "update") {
    if (!receiptExists) {
      throw new Error("Cannot update project: its Copier answers file does not exist");
    }
    return "update";
  }
  return receiptExists ? "update" : "create";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

interface CopierReceipt {
  readonly _src_path?: unknown;
  readonly _commit?: unknown;
}

async function readReceipt(receiptPath: string): Promise<CopierReceipt> {
  const receipt = parse(await readFile(receiptPath, "utf8")) as CopierReceipt;
  if (receipt === null || typeof receipt !== "object") {
    throw new Error("Copier answers file is not a YAML object");
  }
  return receipt;
}

function sourceMatches(recorded: unknown, expected: string): boolean {
  if (typeof recorded !== "string") return false;
  if (recorded === expected) return true;
  return path.isAbsolute(recorded) && path.isAbsolute(expected)
    ? path.normalize(recorded) === path.normalize(expected)
    : false;
}

function isImmutableRevision(recorded: unknown): recorded is string {
  return typeof recorded === "string" && /^[0-9a-f]{40}$/.test(recorded);
}

async function runCopier(
  worktreeRoot: string,
  temporaryRoot: string,
  operation: CopierOperation,
  plan: ProjectPlan,
  template: TemplateSource,
): Promise<void> {
  const relativeAnswersPath = answersPath(plan.project_id);
  const receiptPath = path.join(worktreeRoot, relativeAnswersPath);
  if (operation === "update") {
    const receipt = await readReceipt(receiptPath);
    if (!sourceMatches(receipt._src_path, template.source)) {
      throw new Error(
        `Cannot update project: recorded template source does not match allowlisted template '${template.id}'`,
      );
    }
    if (!isImmutableRevision(receipt._commit)) {
      throw new Error(
        "Cannot update project: recorded template revision is not an immutable full Git SHA",
      );
    }
  }
  const dataFile = path.join(temporaryRoot, "answers.yaml");
  await writeFile(dataFile, stringify(plan.answers), { mode: 0o600 });
  const commonArgs = [
    "--quiet",
    "--defaults",
    "--skip-tasks",
    "--answers-file",
    relativeAnswersPath,
    "--vcs-ref",
    plan.template_revision,
    "--data-file",
    dataFile,
  ];
  const copierOptions = {
    env: {
      ...process.env,
      COPIER_CACHE_DIR: path.join(temporaryRoot, "copier-cache"),
    },
  };
  if (operation === "create") {
    await runCommand("copier", [
      "copy",
      ...commonArgs,
      template.source,
      worktreeRoot,
    ], copierOptions);
  } else {
    await runCommand("copier", [
      "update",
      ...commonArgs,
      "--conflict",
      "inline",
      worktreeRoot,
    ], copierOptions);
  }
  const receipt = await readReceipt(receiptPath);
  if (!sourceMatches(receipt._src_path, template.source)) {
    throw new Error(
      `Copier wrote unexpected template provenance: source=${JSON.stringify(receipt._src_path)}`,
    );
  }
  await writeFile(
    receiptPath,
    stringify({
      ...receipt,
      _commit: plan.template_revision,
      _src_path: template.source,
    }),
    "utf8",
  );
}

async function changedPaths(
  worktreeRoot: string,
  baseline: string,
): Promise<string[]> {
  await runCommand("git", ["-C", worktreeRoot, "add", "--intent-to-add", "."]);
  const result = await runCommand("git", [
    "-C",
    worktreeRoot,
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    baseline,
    "--",
  ]);
  return splitNullTerminated(result.stdout).sort((left, right) =>
    left.localeCompare(right),
  );
}

function validateOwnedPaths(plan: ProjectPlan): void {
  for (const ownedPath of plan.owned_paths) {
    for (const manifestPath of SHARED_MANIFEST_PATHS) {
      if (
        manifestPath === ownedPath ||
        manifestPath.startsWith(`${ownedPath}/`)
      ) {
        throw new Error(
          `Owned path '${ownedPath}' would include shared manifest '${manifestPath}'`,
        );
      }
    }
  }
}

function pathIsOwned(relativePath: string, plan: ProjectPlan): boolean {
  if (relativePath === answersPath(plan.project_id)) return true;
  if (
    plan.owned_paths.some(
      (ownedPath) =>
        relativePath === ownedPath || relativePath.startsWith(`${ownedPath}/`),
    )
  ) {
    return true;
  }
  const editableManifests = new Set(
    plan.shared_manifest_edits.map(manifestPathForEdit),
  );
  return editableManifests.has(relativePath);
}

function assertAuthorizedChanges(
  paths: readonly string[],
  plan: ProjectPlan,
): void {
  const unauthorized = paths.filter(
    (relativePath) => !pathIsOwned(relativePath, plan),
  );
  if (unauthorized.length > 0) {
    throw new Error(
      `Template changed paths outside its declared ownership: ${unauthorized.join(", ")}`,
    );
  }
}

async function assertNoConflicts(
  worktreeRoot: string,
  baseline: string,
  paths: readonly string[],
): Promise<void> {
  const rejectFile = paths.find((relativePath) => relativePath.endsWith(".rej"));
  if (rejectFile) {
    throw new Error(`Copier left unresolved rejection file '${rejectFile}'`);
  }
  const diffCheck = await runCommand(
    "git",
    ["-C", worktreeRoot, "diff", "--check", baseline, "--"],
    { allowFailure: true },
  );
  if (diffCheck.exitCode !== 0) {
    throw new Error(
      `Generated changes contain conflict markers or whitespace errors: ${diffCheck.stdout.trim() || diffCheck.stderr.trim()}`,
    );
  }
}

async function createPatch(
  worktreeRoot: string,
  baseline: string,
): Promise<string> {
  await runCommand("git", ["-C", worktreeRoot, "add", "--intent-to-add", "."]);
  return (
    await runCommand("git", [
      "-C",
      worktreeRoot,
      "diff",
      "--binary",
      "--full-index",
      "--no-renames",
      baseline,
      "--",
    ])
  ).stdout;
}

async function runChecks(
  worktreeRoot: string,
  template: TemplateSource,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const task of template.checks) {
    await runCommand("mise", [task], {
      cwd: worktreeRoot,
      env: {
        ...process.env,
        MISE_TRUSTED_CONFIG_PATHS: worktreeRoot,
      },
    });
    results.push({ task, status: "passed" });
  }
  return results;
}

async function applyPatch(
  repositoryRoot: string,
  patch: string,
): Promise<void> {
  if (!patch) return;
  await runCommand(
    "git",
    ["-C", repositoryRoot, "apply", "--check", "--binary", "-"],
    { input: patch },
  );
  await runCommand(
    "git",
    ["-C", repositoryRoot, "apply", "--binary", "-"],
    { input: patch },
  );
}

async function resolveRepositoryRoot(repository: string): Promise<string> {
  const root = (
    await runCommand("git", ["-C", repository, "rev-parse", "--show-toplevel"])
  ).stdout.trim();
  return realpath(root);
}

function pathIsDeclaredOwned(
  relativePath: string,
  plan: ProjectPlan,
): boolean {
  return plan.owned_paths.some(
    (ownedPath) =>
      relativePath === ownedPath || relativePath.startsWith(`${ownedPath}/`),
  );
}

async function inventoryOwnedFiles(
  repositoryRoot: string,
  plan: ProjectPlan,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const inventories = await Promise.all(
    plan.owned_paths.map((ownedPath) =>
      inventoryFiles(repositoryRoot, ownedPath),
    ),
  );
  for (const ownedFiles of inventories) {
    for (const item of ownedFiles) files.set(...item);
  }
  return files;
}

async function classifyAdoptionPaths(
  worktreeRoot: string,
  renderRoot: string,
  plan: ProjectPlan,
): Promise<AdoptionPath[]> {
  const receiptPath = answersPath(plan.project_id);
  const [renderedFiles, checkoutFiles] = await Promise.all([
    inventoryFiles(renderRoot),
    inventoryOwnedFiles(worktreeRoot, plan),
  ]);
  renderedFiles.delete(receiptPath);
  const paths: AdoptionPath[] = await Promise.all(
    [...renderedFiles].map(async ([relativePath, renderedDigest]) => {
      if (!pathIsDeclaredOwned(relativePath, plan)) {
        return {
          path: relativePath,
          classification: "outside_ownership",
          disposition: "reject_template_file",
        } satisfies AdoptionPath;
      }
      const checkoutPath = path.join(worktreeRoot, relativePath);
      let checkoutExists: boolean;
      try {
        checkoutExists = await pathExists(checkoutPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
        return {
          path: relativePath,
          classification: "conflicting",
          disposition: "review_conflict",
        } satisfies AdoptionPath;
      }
      if (!checkoutExists) {
        return {
          path: relativePath,
          classification: "adoptable",
          disposition: "add_template_file",
        } satisfies AdoptionPath;
      }
      const checkoutDigest = await adoptionDigest(checkoutPath);
      return checkoutDigest === renderedDigest
        ? ({
            path: relativePath,
            classification: "matching",
            disposition: "already_matches",
          } satisfies AdoptionPath)
        : ({
            path: relativePath,
            classification: "conflicting",
            disposition: "review_conflict",
          } satisfies AdoptionPath);
    }),
  );

  for (const relativePath of checkoutFiles.keys()) {
    if (renderedFiles.has(relativePath)) continue;
    paths.push({
      path: relativePath,
      classification: "adoptable",
      disposition: "preserve_local_file",
    });
  }
  return paths.toSorted((left, right) => left.path.localeCompare(right.path));
}

async function classifySharedManifestEdits(
  worktreeRoot: string,
  edits: readonly SharedManifestEdit[],
): Promise<AdoptionSharedManifestEdit[]> {
  const results: AdoptionSharedManifestEdit[] = [];
  for (const edit of edits) {
    const manifestPath = manifestPathForEdit(edit);
    try {
      // These writes must stay serial because later edits may target the same manifest.
      const changed = await applySharedManifestEdits(worktreeRoot, [edit]); // NOSONAR
      results.push({
        path: manifestPath,
        classification: changed.length > 0 ? "adoptable" : "matching",
        edit,
      });
    } catch (error) {
      results.push({
        path: manifestPath,
        classification: "conflicting",
        edit,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

function localExceptions(
  blueprint: ResolvedProjectBlueprint,
  paths: readonly AdoptionPath[],
): AdoptionPlanResult["localExceptions"] {
  return {
    overrides: blueprint.selections.filter(
      (selection) => selection.source === "override",
    ),
    taskExceptions: blueprint.components.flatMap((component) =>
      component.tasks.flatMap((task) =>
        task.disposition === "not-applicable" && task.reason
          ? [
              {
                componentId: component.id,
                task: task.name,
                reason: task.reason,
              },
            ]
          : [],
      ),
    ),
    preservedPaths: paths
      .filter(({ disposition }) => disposition === "preserve_local_file")
      .map(({ path: relativePath }) => relativePath),
  };
}

export async function planProjectAdoption(input: {
  readonly repository: string;
  readonly plan: ProjectPlan;
  readonly template: TemplateSource & { readonly revision: string };
  readonly blueprint: ResolvedProjectBlueprint;
}): Promise<AdoptionPlanResult> {
  validateOwnedPaths(input.plan);
  if (input.template.id !== input.plan.template_id) {
    throw new Error(
      `Plan selects template '${input.plan.template_id}', not '${input.template.id}'`,
    );
  }
  if (input.template.revision !== input.plan.template_revision) {
    throw new Error(
      `Plan pins template revision '${input.plan.template_revision}', not '${input.template.revision}'`,
    );
  }
  if (!isDeepStrictEqual(input.plan.answers.blueprint, input.blueprint)) {
    throw new Error(
      "Adoption plan answers do not contain the supplied resolved blueprint",
    );
  }
  const repositoryRoot = await resolveRepositoryRoot(input.repository);
  const snapshot = await captureSnapshot(repositoryRoot);
  const temporaryRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "project-adoption-planner-")),
  );
  let worktreeRoot: string | undefined;
  try {
    const prepared = await prepareWorktree(
      repositoryRoot,
      snapshot,
      temporaryRoot,
    );
    worktreeRoot = prepared.worktreeRoot;
    const receiptPath = answersPath(input.plan.project_id);
    if (await pathExists(path.join(worktreeRoot, receiptPath))) {
      throw new Error(
        `Cannot plan adoption: Copier answers file '${receiptPath}' already exists`,
      );
    }
    const renderRoot = path.join(temporaryRoot, "isolated-render");
    await mkdir(renderRoot, { recursive: true });
    await runCopier(
      renderRoot,
      temporaryRoot,
      "create",
      input.plan,
      input.template,
    );
    const paths = await classifyAdoptionPaths(
      worktreeRoot,
      renderRoot,
      input.plan,
    );
    const sharedManifestEdits = await classifySharedManifestEdits(
      worktreeRoot,
      input.plan.shared_manifest_edits,
    );
    const readyToAdopt =
      !paths.some(
        ({ classification }) =>
          classification === "conflicting" ||
          classification === "outside_ownership",
      ) &&
      !sharedManifestEdits.some(
        ({ classification }) => classification === "conflicting",
      );
    return {
      schemaVersion: 1,
      projectId: input.plan.project_id,
      baseRevision: snapshot.head,
      effectiveAt: input.blueprint.effective_at,
      template: {
        id: input.template.id,
        source: input.template.source,
        revision: input.template.revision,
      },
      resolvedBlueprint: input.blueprint,
      receipt: {
        path: receiptPath,
        classification: "adoptable",
        disposition: "create_after_review",
      },
      readyToAdopt,
      paths,
      sharedManifestEdits,
      localExceptions: localExceptions(input.blueprint, paths),
    };
  } finally {
    if (worktreeRoot) {
      await runCommand(
        "git",
        ["-C", repositoryRoot, "worktree", "remove", "--force", worktreeRoot],
        { allowFailure: true },
      );
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

export async function executeProjectPlan(input: {
  readonly repository: string;
  readonly mode: GenerationMode;
  readonly plan: ProjectPlan;
  readonly template: TemplateSource;
}): Promise<GenerationResult> {
  validateOwnedPaths(input.plan);
  if (input.template.id !== input.plan.template_id) {
    throw new Error(
      `Plan selects template '${input.plan.template_id}', not '${input.template.id}'`,
    );
  }
  const repositoryRoot = await resolveRepositoryRoot(input.repository);
  const snapshot = await captureSnapshot(repositoryRoot);
  const temporaryRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "project-generator-")),
  );
  let worktreeRoot: string | undefined;
  try {
    const prepared = await prepareWorktree(
      repositoryRoot,
      snapshot,
      temporaryRoot,
    );
    worktreeRoot = prepared.worktreeRoot;
    const receiptExists = await pathExists(
      path.join(worktreeRoot, answersPath(input.plan.project_id)),
    );
    const operation = resolveOperation(input.mode, receiptExists);
    await runCopier(
      worktreeRoot,
      temporaryRoot,
      operation,
      input.plan,
      input.template,
    );

    const copierPaths = await changedPaths(worktreeRoot, prepared.baseline);
    const sharedManifestChanges = copierPaths.filter((relativePath) =>
      SHARED_MANIFEST_PATHS.has(relativePath),
    );
    if (sharedManifestChanges.length > 0) {
      throw new Error(
        `Copier templates must not edit shared manifests: ${sharedManifestChanges.join(", ")}`,
      );
    }

    await applySharedManifestEdits(
      worktreeRoot,
      input.plan.shared_manifest_edits,
    );
    const candidatePaths = await changedPaths(worktreeRoot, prepared.baseline);
    assertAuthorizedChanges(candidatePaths, input.plan);
    await assertNoConflicts(
      worktreeRoot,
      prepared.baseline,
      candidatePaths,
    );
    const patchBeforeChecks = await createPatch(
      worktreeRoot,
      prepared.baseline,
    );
    const checks = await runChecks(worktreeRoot, input.template);
    const patch = await createPatch(worktreeRoot, prepared.baseline);
    if (patch !== patchBeforeChecks) {
      throw new Error("A generated-project check modified the candidate changes");
    }

    const apply = input.mode === "create" || input.mode === "update";
    if (apply) {
      const currentSnapshot = await captureSnapshot(repositoryRoot);
      if (currentSnapshot.fingerprint !== snapshot.fingerprint) {
        throw new Error(
          "Repository changed while the project plan was running; retry against the new state",
        );
      }
      await applyPatch(repositoryRoot, patch);
    }
    return {
      schemaVersion: 1,
      projectId: input.plan.project_id,
      operation,
      templateId: input.template.id,
      templateRevision: input.plan.template_revision,
      baseRevision: snapshot.head,
      applied: apply,
      changedPaths: candidatePaths,
      checks,
      diff: patch,
    };
  } finally {
    if (worktreeRoot) {
      await runCommand(
        "git",
        ["-C", repositoryRoot, "worktree", "remove", "--force", worktreeRoot],
        { allowFailure: true },
      );
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}
