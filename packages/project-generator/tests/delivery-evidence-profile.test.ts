import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { projectPlanFromBlueprint } from "../src/profile-plan.js";
import {
  parseProjectProfile,
  parseProjectProfileContracts,
  resolveProjectProfile,
  serializeResolvedBlueprint,
  validateResolvedDeliveryEvidenceCatalog,
  type ProjectProfileContracts,
  type ResolvedDeliveryEvidence,
} from "../src/profile.js";

const repositoryRoot = new URL("../../../", import.meta.url);
const platformRoot = new URL(
  "ui/content/projects/personal-engineering-platform/",
  repositoryRoot,
);
const effectiveAt = "2026-11-04T00:00:00Z";

async function contracts(): Promise<ProjectProfileContracts> {
  const [layout, platform, nix, opentelemetry, deploymentMaturity] =
    await Promise.all([
      readFile(new URL("repository-layout.yaml", platformRoot), "utf8"),
      readFile(new URL("platform.yaml", platformRoot), "utf8"),
      readFile(new URL("nix-flake-contract.yaml", platformRoot), "utf8"),
      readFile(new URL("opentelemetry-contract.yaml", platformRoot), "utf8"),
      readFile(new URL("deployment-maturity.yaml", platformRoot), "utf8"),
    ]);
  return parseProjectProfileContracts({
    layout,
    platform,
    nix,
    opentelemetry,
    deploymentMaturity,
  });
}

async function blueprint(projectId: "recipe-site" | "work-graph") {
  const [profileSource, currentContracts] = await Promise.all([
    readFile(
      new URL(`ui/content/projects/${projectId}/project-profile.yaml`, repositoryRoot),
      "utf8",
    ),
    contracts(),
  ]);
  return resolveProjectProfile(
    parseProjectProfile(profileSource),
    currentContracts,
    effectiveAt,
  );
}

describe("production project delivery evidence", () => {
  it("compiles Work Graph component ownership into stable evidence targets", async () => {
    const first = await blueprint("work-graph");
    const second = await blueprint("work-graph");

    expect(first).toMatchObject({
      schema_version: 4,
      profile_schema_version: 3,
      delivery_evidence: {
        repository: "Robbie-Palmer/hq",
        targets: [
          {
            id: "delivery-target:work-graph/api",
            github: {
              required_ci_names: ["Work Graph API CI"],
              production_environments: ["production-work-graph"],
            },
          },
          { id: "delivery-target:work-graph/infrastructure" },
          { id: "delivery-target:work-graph/observer" },
          {
            id: "delivery-target:work-graph/site-ui",
            shared_host_id: "shared-host:site-ui",
          },
        ],
      },
    });
    expect(
      first.delivery_evidence?.targets[0]?.source_paths.map(({ path }) => path),
    ).toContain("workers/work-graph-api");
    expect(first.catalog.delivery_targets).toHaveLength(4);
    const plan = projectPlanFromBlueprint({
      blueprint: first,
      contracts: await contracts(),
      template: {
        id: "monorepo-project",
        source: "https://example.invalid/monorepo-project.git",
        revision: "a".repeat(40),
        checks: ["//:layout:check"],
      },
    });
    expect(plan.shared_manifest_edits).toContainEqual(
      expect.objectContaining({
        kind: "catalog_record",
        value: expect.objectContaining({
          id: "delivery-target:work-graph/api",
          kind: "delivery-target",
        }),
      }),
    );
    expect(serializeResolvedBlueprint(first)).toBe(
      serializeResolvedBlueprint(second),
    );
  });

  it("keeps the Recipe Site UI identity stable when its shared-host path moves", async () => {
    const profileSource = await readFile(
      new URL("ui/content/projects/recipe-site/project-profile.yaml", repositoryRoot),
      "utf8",
    );
    const currentContracts = await contracts();
    const profile = parseProjectProfile(profileSource);
    const before = resolveProjectProfile(profile, currentContracts, effectiveAt);
    const movedContracts = structuredClone(currentContracts);
    const catalog = movedContracts.platform.catalog as {
      records: Array<Record<string, unknown>>;
    };
    const web = catalog.records.find(
      ({ id }) => id === "component:recipe-site/web",
    );
    if (!web) throw new Error("Recipe Site web catalog record is missing");
    web.source_paths = ["ui/app/_projects/recipe-site"];
    const after = resolveProjectProfile(profile, movedContracts, effectiveAt);
    const beforeTarget = before.delivery_evidence?.targets.find(
      ({ id }) => id === "delivery-target:recipe-site/site-ui",
    );
    const afterTarget = after.delivery_evidence?.targets.find(
      ({ id }) => id === "delivery-target:recipe-site/site-ui",
    );

    expect(beforeTarget).toMatchObject({
      subjects: ["component:recipe-site/web"],
      shared_host_id: "shared-host:site-ui",
    });
    expect(beforeTarget?.source_paths.map(({ path }) => path)).toContain("ui");
    expect(afterTarget).toMatchObject({
      id: beforeTarget?.id,
      subjects: beforeTarget?.subjects,
      shared_host_id: beforeTarget?.shared_host_id,
    });
    expect(afterTarget?.source_paths.map(({ path }) => path)).toContain(
      "ui/app/_projects/recipe-site",
    );
  });

  it("accepts explicit shared paths and rejects an exclusive overlap", async () => {
    const [workGraph, recipeSite] = await Promise.all([
      blueprint("work-graph"),
      blueprint("recipe-site"),
    ]);
    const evidence = [
      workGraph.delivery_evidence,
      recipeSite.delivery_evidence,
    ].filter(
      (item): item is ResolvedDeliveryEvidence => item !== undefined,
    );

    expect(() => validateResolvedDeliveryEvidenceCatalog(evidence)).not.toThrow();

    const conflicting: ResolvedDeliveryEvidence[] = evidence.map(
      (contract) => ({
        ...contract,
        targets: contract.targets.map((target) => ({
          ...target,
          source_paths: target.source_paths.map((sourcePath) =>
            target.id === "delivery-target:work-graph/site-ui" &&
            sourcePath.path === "ui/content/projects/work-graph"
              ? { ...sourcePath, mode: "exclusive" as const }
              : sourcePath,
          ),
        })),
      }),
    );

    expect(() => validateResolvedDeliveryEvidenceCatalog(conflicting)).toThrow(
      /conflicting source paths/,
    );
  });
});
