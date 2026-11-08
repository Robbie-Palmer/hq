import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadLayoutContract,
  parseLayoutContract,
  validateLayoutContract,
  validateRepositoryLayout,
} from "./check-monorepo-layout.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("monorepo layout contract", () => {
  it("matches the current repository structure", async () => {
    const contract = await loadLayoutContract(repositoryRoot);

    await expect(
      validateRepositoryLayout(repositoryRoot, contract),
    ).resolves.toEqual([]);
  });

  it("rejects changes to the generator shared-manifest boundary", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    contract.shared_manifests[0].allowed_edits.push("tools");

    expect(validateLayoutContract(contract)).toContain(
      "Shared manifest edits must remain limited to project registrations, mise config roots, pnpm packages, and platform catalog records",
    );
  });

  it("rejects duplicate shared-manifest paths", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    contract.shared_manifests.unshift({
      path: ".mise.toml",
      allowed_edits: ["tasks"],
    });

    expect(validateLayoutContract(contract)).toContain(
      "Shared manifest edits must remain limited to project registrations, mise config roots, pnpm packages, and platform catalog records",
    );
  });

  it("reports malformed contract fields before validation", () => {
    expect(() =>
      parseLayoutContract({
        schema_version: 1,
        projects: [{ id: "broken", kind: "service" }],
      }),
    ).toThrow(/projects\.0\.catalog_record/);
  });

  it("rejects duplicate component kinds", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    contract.component_kinds.push(structuredClone(contract.component_kinds[0]));

    expect(validateLayoutContract(contract)).toContain(
      "Duplicate component kind ID 'ui'",
    );
  });

  it("validates component task ownership", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    const projectUi = contract.component_kinds.find(
      ({ id }) => id === "project-ui",
    );
    if (!projectUi) throw new Error("Missing project-ui component kind");
    delete projectUi.delegated_task_project;

    expect(validateLayoutContract(contract)).toContain(
      "Component kind 'project-ui' delegates tasks without a target project",
    );

    projectUi.task_ownership = "generated";
    expect(validateLayoutContract(contract)).toEqual(
      expect.arrayContaining([
        "Component kind 'project-ui' cannot generate tasks without a mise root",
      ]),
    );

    projectUi.task_ownership = "inherited";
    projectUi.delegated_task_project = "//ui";
    expect(validateLayoutContract(contract)).toContain(
      "Component kind 'project-ui' has a delegated task target but does not delegate tasks",
    );

    projectUi.task_ownership = "delegated";
    projectUi.mise_config_root = true;
    expect(validateLayoutContract(contract)).toContain(
      "Component kind 'project-ui' cannot own a mise root and delegate its tasks",
    );
  });

  it("rejects malformed paths and incomplete task profiles", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    contract.project_kinds[0].task_profile = "custom";
    const recipeSite = contract.projects.find(({ id }) => id === "recipe-site");
    if (!recipeSite) throw new Error("Missing recipe-site test registration");
    recipeSite.kind = "unknown";
    contract.component_kinds[0].directory = "../ui";
    contract.task_contract.required.pop();
    contract.knowledge_graph.project_index = "projects/index.mdx";

    expect(validateLayoutContract(contract)).toEqual(
      expect.arrayContaining([
        "Component path '../ui' must be repository-relative",
        "The project index path is missing a required placeholder",
        "Project kind 'application' must use task profile 'standard'",
        "Project 'recipe-site' uses unknown project kind 'unknown'",
        "The task contract must contain install, format, lint, typecheck-or-compile, test, build, and clean",
      ]),
    );
  });

  it("allows compatibility paths only during migration enforcement", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    if (contract.schema_version !== 2) throw new Error("Expected layout v2");

    expect(validateLayoutContract(contract)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Final layout")]),
    );

    contract.enforcement = "final";
    expect(validateLayoutContract(contract)).toEqual(
      expect.arrayContaining([
        "Final layout cannot retain migration knowledge-graph paths",
        "Final layout cannot retain migration-only component kind 'ui'",
        "Final layout cannot retain migration directories for component kind 'worker'",
        "Final layout cannot retain a migration delegated task target for component kind 'project-ui'",
      ]),
    );

    delete contract.migration_knowledge_graph;
    contract.component_kinds = contract.component_kinds
      .filter(({ migration_only: migrationOnly }) => !migrationOnly)
      .map((component) => ({
        ...component,
        migration_directories: [],
        migration_delegated_task_project: undefined,
      }));
    expect(validateLayoutContract(contract)).toEqual([]);
  });

  it("requires compatibility knowledge-graph paths during migration", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    if (contract.schema_version !== 2) throw new Error("Expected layout v2");
    delete contract.migration_knowledge_graph;

    expect(validateLayoutContract(contract)).toContain(
      "Migration layout must declare migration knowledge-graph paths",
    );
  });

  it("requires component kinds to use their declared technology root", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    if (contract.schema_version !== 2) throw new Error("Expected layout v2");
    const worker = contract.component_kinds.find(({ id }) => id === "worker");
    if (!worker) throw new Error("Missing worker component kind");
    worker.directory = "python/apps/worker";

    expect(validateLayoutContract(contract)).toContain(
      "Component kind 'worker' must resolve below technology root 'typescript'",
    );
  });

  it("rejects a project registration without its catalog system", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    const recipeSite = contract.projects.find(({ id }) => id === "recipe-site");
    if (!recipeSite) throw new Error("Missing recipe-site test registration");
    recipeSite.catalog_record = "system:recipe-site/missing";

    await expect(
      validateRepositoryLayout(repositoryRoot, contract),
    ).resolves.toContain(
      "Registered project 'recipe-site' references missing catalog record 'system:recipe-site/missing'",
    );
  });
});
