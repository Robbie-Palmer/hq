import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadCloudflareTokenMigrationManifest,
  parseCloudflareTokenMigrationManifest,
  validateCloudflareTokenMigrationManifest,
  validateCloudflareTokenMigrationRepositoryReferences,
} from "./check-cloudflare-token-migration.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("Cloudflare token migration manifest", () => {
  it("covers every known config and consumer", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    expect(validateCloudflareTokenMigrationManifest(manifest)).toEqual([]);
    expect(
      await validateCloudflareTokenMigrationRepositoryReferences(manifest, repositoryRoot),
    ).toEqual([]);
  });

  it("rejects a config without an owned migration entry", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials.find(
      ({ id }) => id === "public-platform-terraform",
    );
    if (!credential) throw new Error("Missing public-platform credential fixture");
    credential.source_locations = credential.source_locations.filter(
      ({ config }) => config !== "dev_infra",
    );

    expect(validateCloudflareTokenMigrationManifest(manifest)).toContain(
      "Source location 'personal-site/dev_infra/CLOUDFLARE_API_TOKEN' must appear exactly once; found 0",
    );
  });

  it("rejects a consumer without an owned migration entry", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials.find(
      ({ id }) => id === "recipe-production-deploy",
    );
    if (!credential) throw new Error("Missing Recipe production credential fixture");
    credential.destinations = credential.destinations.filter(
      (destination) =>
        destination.kind !== "github-environment" ||
        destination.environment !== "production-recipe-ingest",
    );

    expect(validateCloudflareTokenMigrationManifest(manifest)).toContain(
      "GitHub consumer 'production-recipe-ingest/CLOUDFLARE_API_TOKEN' must appear exactly once; found 0",
    );
  });

  it("requires every source to retain a Doppler destination", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials.find(
      ({ id }) => id === "ai-review-staging-deploy",
    );
    if (!credential) throw new Error("Missing AI review staging fixture");
    credential.destinations = [];

    expect(validateCloudflareTokenMigrationManifest(manifest)).toContain(
      "ai-review-staging-deploy: source 'ai-review/stg/CLOUDFLARE_API_TOKEN' lacks its Doppler destination",
    );
  });

  it("rejects duplicate credential ids and rotation orders", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    manifest.credentials[1].id = manifest.credentials[0].id;
    manifest.credentials[1].rotation_order = manifest.credentials[0].rotation_order;

    expect(validateCloudflareTokenMigrationManifest(manifest)).toEqual(
      expect.arrayContaining([
        `Duplicate credential id '${manifest.credentials[0].id}'`,
        `Duplicate rotation order '${manifest.credentials[0].rotation_order}'`,
      ]),
    );
  });

  it("requires repeated source locations to describe a shared credential", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials.find(
      ({ source_locations }) => source_locations.length > 1,
    );
    if (!credential) throw new Error("Missing shared credential fixture");
    credential.repeated_name_relation = "distinct";

    expect(validateCloudflareTokenMigrationManifest(manifest)).toContain(
      `${credential.id}: multiple source locations must declare a shared credential`,
    );
  });

  it("requires the audited account and exact zones for scoped permissions", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials.find(({ permission_groups }) =>
      permission_groups.some(({ scope }) => scope === "zone"),
    );
    if (!credential) throw new Error("Missing zone-scoped credential fixture");
    credential.resources = credential.resources.filter(
      (resource) =>
        resource !== `account:${manifest.cloudflare_account_id}` &&
        !resource.startsWith("zone:"),
    );

    expect(validateCloudflareTokenMigrationManifest(manifest)).toEqual(
      expect.arrayContaining([
        `${credential.id}: resources must name the audited Cloudflare account`,
        `${credential.id}: zone permissions require an exact zone resource`,
      ]),
    );
  });

  it("rejects source locations and consumers outside the audited set", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials[0];
    credential.source_locations[0].config = "unknown";
    const githubDestination = credential.destinations.find(
      (destination) => destination.kind === "github-environment",
    );
    if (!githubDestination) throw new Error("Missing GitHub destination fixture");
    githubDestination.environment = "unknown";

    expect(validateCloudflareTokenMigrationManifest(manifest)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Unknown source location /),
        expect.stringMatching(/^Unknown github consumer /),
      ]),
    );
  });

  it("rejects verification tasks that do not exist", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials[0];
    credential.consumer_verification[0] = "mise //:missing-cloudflare-task";

    expect(
      await validateCloudflareTokenMigrationRepositoryReferences(manifest, repositoryRoot),
    ).toContain(
      `${credential.id}: verification task '//:missing-cloudflare-task' does not exist`,
    );
  });

  it("rejects missing recovery files and anchors", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const missingFileCredential = manifest.credentials[0];
    const missingAnchorCredential = manifest.credentials[1];
    missingFileCredential.recovery_path = "docs/runbooks/missing.md#recovery";
    missingAnchorCredential.recovery_path =
      "docs/runbooks/project-secret-bootstrap.md#missing-anchor";

    expect(
      await validateCloudflareTokenMigrationRepositoryReferences(manifest, repositoryRoot),
    ).toEqual(
      expect.arrayContaining([
        `${missingFileCredential.id}: recovery file 'docs/runbooks/missing.md' does not exist`,
        `${missingAnchorCredential.id}: recovery anchor '#missing-anchor' does not exist in 'docs/runbooks/project-secret-bootstrap.md'`,
      ]),
    );
  });

  it("requires committed bootstrap plans to exist", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials[0];
    credential.bootstrap_plan_status = "committed";

    expect(
      await validateCloudflareTokenMigrationRepositoryReferences(manifest, repositoryRoot),
    ).toContain(
      `${credential.id}: committed bootstrap plan '${credential.bootstrap_plan_path}' does not exist`,
    );
  });

  it("rejects inventory records without an owner or migration ticket", async () => {
    const manifest = await loadCloudflareTokenMigrationManifest(repositoryRoot);
    const credential = manifest.credentials[0] as Partial<
      (typeof manifest.credentials)[number]
    >;
    delete credential.owner_root;
    delete credential.migration_ticket;

    expect(() => parseCloudflareTokenMigrationManifest(manifest)).toThrow(
      /owner_root.*migration_ticket/,
    );
  });
});
