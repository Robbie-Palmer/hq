import { readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { projectPlanFromBlueprint } from "../src/profile-plan.js";
import {
  parseProjectProfile,
  parseProjectProfileContracts,
  resolveProjectProfile,
} from "../src/profile.js";

const platformRoot = new URL(
  "../../../ui/content/projects/personal-engineering-platform/",
  import.meta.url,
);
const workloadUrl = new URL(
  "../../platform-contracts/tests/fixtures/workload/portable-workload-v1.yaml",
  import.meta.url,
);

async function contracts() {
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

async function profile(projectId = "representative-service") {
  const workload = parse(await readFile(workloadUrl, "utf8"));
  return parseProjectProfile(
    stringify({
      schema_version: 2,
      project: {
        id: projectId,
        name: "Representative service",
        kind: "service",
        published: false,
      },
      components: [
        {
          id: "representative-service",
          name: "Representative service",
          kind: "worker",
        },
      ],
      layers: [{ layer: "base" }],
      nix: { boundary: "none" },
      opentelemetry: { enabled: false },
      capabilities: { workloads: [workload] },
    }),
  );
}

describe("project profile workload capability", () => {
  it("resolves profile version 2 workloads into Copier's version 3 blueprint", async () => {
    const currentContracts = await contracts();
    const blueprint = resolveProjectProfile(
      await profile(),
      currentContracts,
      "2026-10-31T00:00:00Z",
    );
    const plan = projectPlanFromBlueprint({
      blueprint,
      contracts: currentContracts,
      template: {
        id: "monorepo-project",
        source: "https://example.invalid/monorepo-project.git",
        revision: "a".repeat(40),
        checks: ["//:layout:check"],
      },
    });

    expect(blueprint).toMatchObject({
      schema_version: 3,
      profile_schema_version: 2,
      project: { id: "representative-service" },
      workloads: [
        {
          contract: "workload-definition",
          contract_version: 1,
          workload: { id: "representative-service" },
        },
      ],
    });
    expect(plan.answers.blueprint).toEqual(blueprint);
  });

  it("rejects workload identity that diverges from the profile", async () => {
    const mismatched = await profile("different-project");
    const currentContracts = await contracts();
    expect(() =>
      resolveProjectProfile(
        mismatched,
        currentContracts,
        "2026-10-31T00:00:00Z",
      ),
    ).toThrow(/project id must match profile project/);
  });
});
