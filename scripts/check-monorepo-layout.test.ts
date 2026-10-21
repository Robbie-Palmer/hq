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

  it("requires component task ownership or delegation", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    const projectUi = contract.component_kinds.find(
      ({ id }) => id === "project-ui",
    );
    if (!projectUi) throw new Error("Missing project-ui component kind");
    delete projectUi.delegated_task_project;

    expect(validateLayoutContract(contract)).toContain(
      "Component kind 'project-ui' without a mise root must delegate its tasks",
    );
  });

  it("rejects malformed paths and incomplete task profiles", async () => {
    const contract = structuredClone(await loadLayoutContract(repositoryRoot));
    contract.schema_version = 2;
    contract.project_kinds[0].task_profile = "custom";
    const recipeSite = contract.projects.find(({ id }) => id === "recipe-site");
    if (!recipeSite) throw new Error("Missing recipe-site test registration");
    recipeSite.kind = "unknown";
    contract.component_kinds[0].directory = "../ui";
    contract.task_contract.required.pop();
    contract.knowledge_graph.project_index = "projects/index.mdx";

    expect(validateLayoutContract(contract)).toEqual(
      expect.arrayContaining([
        "Unsupported layout schema version '2'",
        "Component path '../ui' must be repository-relative",
        "The project index path is missing a required placeholder",
        "Project kind 'application' must use task profile 'standard'",
        "Project 'recipe-site' uses unknown project kind 'unknown'",
        "The task contract must contain install, format, lint, typecheck-or-compile, test, build, and clean",
      ]),
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
