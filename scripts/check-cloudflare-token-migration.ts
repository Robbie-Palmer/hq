import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export const MANIFEST_PATH =
  "infra/account-foundation/cloudflare-token-migration.yaml";

const locationSchema = z
  .object({
    project: z.string().min(1),
    config: z.string().min(1),
    key: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  })
  .strict();

const destinationSchema = z.discriminatedUnion("kind", [
  locationSchema.extend({ kind: z.literal("doppler-config") }).strict(),
  z
    .object({
      kind: z.literal("github-environment"),
      environment: z.string().min(1),
      key: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    })
    .strict(),
]);

const permissionGroupSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{32}$/),
    name: z.string().min(1),
    scope: z.enum(["account", "zone"]),
  })
  .strict();

const credentialSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    current_group: z.string().min(1),
    repeated_name_relation: z.enum(["distinct", "shared"]),
    source_locations: z.array(locationSchema).min(1),
    destinations: z.array(destinationSchema).min(1),
    owner_root: z.string().min(1),
    migration_ticket: z.string().min(1),
    resources: z.array(z.string().min(1)).min(1),
    permission_groups: z.array(permissionGroupSchema).min(1),
    consumer_verification: z
      .array(z.string().regex(/^mise \/\/[a-zA-Z0-9/:.-]+/))
      .min(1),
    rotation_order: z.number().int().positive(),
    recovery_path: z
      .string()
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_./-]+\.md#[a-z0-9-]+$/),
    bootstrap_plan_status: z.enum(["planned", "committed"]),
    bootstrap_plan_path: z
      .string()
      .regex(/^infra\/account-foundation\/cloudflare-token-plans\/[a-z0-9-]+\.yaml$/),
  })
  .strict();

const manifestSchema = z
  .object({
    schema_version: z.literal(1),
    audited_at: z.iso.date(),
    cloudflare_account_id: z.string().regex(/^[0-9a-f]{32}$/),
    credentials: z.array(credentialSchema).min(1),
  })
  .strict();

export type CloudflareTokenMigrationManifest = z.infer<typeof manifestSchema>;

const expectedSourceLocations = [
  "ai-review/prd/CLOUDFLARE_API_TOKEN",
  "ai-review/stg/CLOUDFLARE_API_TOKEN",
  "cloudflare-access/ops_apply/CLOUDFLARE_API_TOKEN",
  "cloudflare-access/ops_drift/CLOUDFLARE_API_TOKEN",
  "cloudflare-access/ops_plan/CLOUDFLARE_API_TOKEN",
  "cloudflare-token-bootstrap/ops_provisioner/CLOUDFLARE_BOOTSTRAP_TOKEN",
  "cloudflare-token-bootstrap/ops_provisioner/CLOUDFLARE_TOKEN_PROVISIONER_TOKEN",
  "personal-site/dev_infra/CLOUDFLARE_API_TOKEN",
  "personal-site/ops_preview_agent_access/CLOUDFLARE_API_TOKEN",
  "personal-site/prd_infra/CLOUDFLARE_API_TOKEN",
  "personal-site/prd_site_ui/CLOUDFLARE_API_TOKEN",
  "personal-site/stg_recipe_api/CLOUDFLARE_API_TOKEN",
  "personal-site/stg_site_ui/CLOUDFLARE_API_TOKEN",
  "work-graph/prd_work_graph/CLOUDFLARE_API_TOKEN",
  "work-graph/prd_work_graph/CLOUDFLARE_DIAGNOSTICS_API_TOKEN",
  "work-graph/prd_work_graph/OBSERVER_CLOUDFLARE_API_TOKEN",
  "work-graph/prd_work_graph_infra/CLOUDFLARE_API_TOKEN",
] as const;

const expectedGitHubConsumers = [
  "preview-agent-access/CLOUDFLARE_API_TOKEN",
  "preview-recipe-api/CLOUDFLARE_API_TOKEN",
  "preview-site-ui/CLOUDFLARE_API_TOKEN",
  "production-ai-review/CLOUDFLARE_API_TOKEN",
  "production-cloudflare-access/CLOUDFLARE_API_TOKEN",
  "production-cloudflare-access-drift/CLOUDFLARE_API_TOKEN",
  "production-cloudflare-access-plan/CLOUDFLARE_API_TOKEN",
  "production-cloudflare-token-bootstrap/CLOUDFLARE_BOOTSTRAP_TOKEN",
  "production-cloudflare-token-bootstrap/CLOUDFLARE_TOKEN_PROVISIONER_TOKEN",
  "production-infra/CLOUDFLARE_API_TOKEN",
  "production-recipe-api/CLOUDFLARE_API_TOKEN",
  "production-recipe-ingest/CLOUDFLARE_API_TOKEN",
  "production-site-ui/CLOUDFLARE_API_TOKEN",
  "production-work-graph/CLOUDFLARE_API_TOKEN",
  "production-work-graph/CLOUDFLARE_DIAGNOSTICS_API_TOKEN",
  "production-work-graph/OBSERVER_CLOUDFLARE_API_TOKEN",
  "production-work-graph-infra/CLOUDFLARE_API_TOKEN",
] as const;

function sourceKey(location: z.infer<typeof locationSchema>): string {
  return `${location.project}/${location.config}/${location.key}`;
}

function githubConsumerKey(
  destination: Extract<z.infer<typeof destinationSchema>, { kind: "github-environment" }>,
): string {
  return `${destination.environment}/${destination.key}`;
}

function coverageErrors(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const value of actual) counts.set(value, (counts.get(value) ?? 0) + 1);
  const errors: string[] = [];
  for (const value of expected) {
    const count = counts.get(value) ?? 0;
    if (count !== 1) errors.push(`${label} '${value}' must appear exactly once; found ${count}`);
  }
  for (const value of counts.keys()) {
    if (!expected.includes(value)) errors.push(`Unknown ${label.toLowerCase()} '${value}'`);
  }
  return errors;
}

export function parseCloudflareTokenMigrationManifest(
  value: unknown,
): CloudflareTokenMigrationManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.map(String).join(".") || "manifest"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid Cloudflare token migration manifest: ${details}`);
  }
  return result.data;
}

export function validateCloudflareTokenMigrationManifest(
  manifest: CloudflareTokenMigrationManifest,
): string[] {
  const ids = new Set<string>();
  const rotationOrders = new Set<number>();
  const errors = manifest.credentials.flatMap((credential) =>
    validateCredential(manifest, credential, ids, rotationOrders),
  );

  errors.push(
    ...coverageErrors(
      "Source location",
      expectedSourceLocations,
      manifest.credentials.flatMap(({ source_locations }) =>
        source_locations.map(sourceKey),
      ),
    ),
    ...coverageErrors(
      "GitHub consumer",
      expectedGitHubConsumers,
      manifest.credentials.flatMap(({ destinations }) =>
        destinations
          .filter((destination) => destination.kind === "github-environment")
          .map(githubConsumerKey),
      ),
    ),
  );

  return errors;
}

function markdownHeadingAnchors(source: string): Set<string> {
  const occurrences = new Map<string, number>();
  const anchors = new Set<string>();

  for (const line of source.split("\n")) {
    const match = /^(?:#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .replace(/\s+#+\s*$/, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s/g, "-");
    const count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  return anchors;
}

async function loadMiseTaskNames(repositoryRoot: string): Promise<Set<string>> {
  const { stdout } = await execFileAsync("mise", ["task", "--all", "--json"], {
    cwd: repositoryRoot,
  });
  const tasks = z.array(z.object({ name: z.string() })).parse(JSON.parse(stdout));
  return new Set(tasks.map(({ name }) => name));
}

type Credential = CloudflareTokenMigrationManifest["credentials"][number];

function verificationTaskErrors(
  credential: Credential,
  taskNames: ReadonlySet<string>,
): string[] {
  return credential.consumer_verification.flatMap((command) => {
    const taskName = command.slice("mise ".length);
    return taskNames.has(taskName)
      ? []
      : [`${credential.id}: verification task '${taskName}' does not exist`];
  });
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function recoveryReferenceErrors(
  credential: Credential,
  repositoryRoot: string,
): Promise<string[]> {
  const [recoveryFile, recoveryAnchor] = credential.recovery_path.split("#", 2) as [
    string,
    string,
  ];
  try {
    const recoverySource = await readFile(path.join(repositoryRoot, recoveryFile), "utf8");
    return markdownHeadingAnchors(recoverySource).has(recoveryAnchor)
      ? []
      : [
          `${credential.id}: recovery anchor '#${recoveryAnchor}' does not exist in '${recoveryFile}'`,
        ];
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return [`${credential.id}: recovery file '${recoveryFile}' does not exist`];
  }
}

async function bootstrapPlanReferenceErrors(
  credential: Credential,
  repositoryRoot: string,
): Promise<string[]> {
  if (credential.bootstrap_plan_status === "planned") return [];
  try {
    await readFile(path.join(repositoryRoot, credential.bootstrap_plan_path));
    return [];
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return [
      `${credential.id}: committed bootstrap plan '${credential.bootstrap_plan_path}' does not exist`,
    ];
  }
}

async function credentialRepositoryReferenceErrors(
  credential: Credential,
  repositoryRoot: string,
  taskNames: ReadonlySet<string>,
): Promise<string[]> {
  const [recoveryErrors, bootstrapPlanErrors] = await Promise.all([
    recoveryReferenceErrors(credential, repositoryRoot),
    bootstrapPlanReferenceErrors(credential, repositoryRoot),
  ]);
  return [
    ...verificationTaskErrors(credential, taskNames),
    ...recoveryErrors,
    ...bootstrapPlanErrors,
  ];
}

export async function validateCloudflareTokenMigrationRepositoryReferences(
  manifest: CloudflareTokenMigrationManifest,
  repositoryRoot: string,
): Promise<string[]> {
  const taskNames = await loadMiseTaskNames(repositoryRoot);
  const errors = await Promise.all(
    manifest.credentials.map((credential) =>
      credentialRepositoryReferenceErrors(credential, repositoryRoot, taskNames),
    ),
  );
  return errors.flat();
}

function validateCredential(
  manifest: CloudflareTokenMigrationManifest,
  credential: CloudflareTokenMigrationManifest["credentials"][number],
  ids: Set<string>,
  rotationOrders: Set<number>,
): string[] {
  const errors: string[] = [];
  if (ids.has(credential.id)) errors.push(`Duplicate credential id '${credential.id}'`);
  ids.add(credential.id);

  if (rotationOrders.has(credential.rotation_order)) {
    errors.push(`Duplicate rotation order '${credential.rotation_order}'`);
  }
  rotationOrders.add(credential.rotation_order);

  const dopplerDestinations = credential.destinations
    .filter((destination) => destination.kind === "doppler-config")
    .map(sourceKey);
  for (const source of credential.source_locations.map(sourceKey)) {
    if (!dopplerDestinations.includes(source)) {
      errors.push(`${credential.id}: source '${source}' lacks its Doppler destination`);
    }
  }

  if (
    credential.source_locations.length > 1 &&
    credential.repeated_name_relation !== "shared"
  ) {
    errors.push(`${credential.id}: multiple source locations must declare a shared credential`);
  }

  if (!credential.resources.includes(`account:${manifest.cloudflare_account_id}`)) {
    errors.push(`${credential.id}: resources must name the audited Cloudflare account`);
  }
  if (
    credential.permission_groups.some(({ scope }) => scope === "zone") &&
    !credential.resources.some((resource) => resource.startsWith("zone:"))
  ) {
    errors.push(`${credential.id}: zone permissions require an exact zone resource`);
  }
  return errors;
}

export async function loadCloudflareTokenMigrationManifest(
  repositoryRoot: string,
): Promise<CloudflareTokenMigrationManifest> {
  const source = await readFile(path.join(repositoryRoot, MANIFEST_PATH), "utf8");
  return parseCloudflareTokenMigrationManifest(parse(source));
}

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
  const errors = [
    ...validateCloudflareTokenMigrationManifest(manifest),
    ...(await validateCloudflareTokenMigrationRepositoryReferences(manifest, repositoryRoot)),
  ];
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write(
    `Cloudflare token migration manifest covers ${manifest.credentials.length} credential groups.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
