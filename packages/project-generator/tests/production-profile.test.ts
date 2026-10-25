import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseTemplateRegistry } from "../src/contracts.js";
import {
  projectPlanFromBlueprint,
  requirePinnedTemplate,
} from "../src/profile-plan.js";
import {
  parseProjectProfile,
  parseProjectProfileContracts,
  resolveProjectProfile,
  serializeResolvedBlueprint,
} from "../src/profile.js";

const platformRoot = new URL(
  "../../../ui/content/projects/personal-engineering-platform/",
  import.meta.url,
);
const profileUrl = new URL(
  "../../../ui/content/projects/personal-finance-app/project-profile.yaml",
  import.meta.url,
);
const effectiveAt = "2026-10-25T00:00:00Z";

async function productionBlueprint() {
  const [profileSource, layout, platform, nix, opentelemetry] =
    await Promise.all([
      readFile(profileUrl, "utf8"),
      readFile(new URL("repository-layout.yaml", platformRoot), "utf8"),
      readFile(new URL("platform.yaml", platformRoot), "utf8"),
      readFile(new URL("nix-flake-contract.yaml", platformRoot), "utf8"),
      readFile(new URL("opentelemetry-contract.yaml", platformRoot), "utf8"),
    ]);
  const profile = parseProjectProfile(profileSource);
  const contracts = parseProjectProfileContracts({
    layout,
    platform,
    nix,
    opentelemetry,
  });
  return {
    blueprint: resolveProjectProfile(profile, contracts, effectiveAt),
    contracts,
  };
}

describe("Personal Finance production profile", () => {
  it("resolves the current project boundary deterministically", async () => {
    const first = await productionBlueprint();
    const second = await productionBlueprint();

    expect(serializeResolvedBlueprint(first.blueprint)).toBe(
      serializeResolvedBlueprint(second.blueprint),
    );
    expect(
      first.blueprint.components.map(({ id, kind, path, mount_path }) => ({
        id,
        kind,
        path,
        ...(mount_path === undefined ? {} : { mount_path }),
      })),
    ).toEqual([
      {
        id: "finance-housing-indices",
        kind: "typescript-package",
        path: "packages/finance-housing-indices",
      },
      {
        id: "finance-inflation-indices",
        kind: "typescript-package",
        path: "packages/finance-inflation-indices",
      },
      {
        id: "finance-tax-rules",
        kind: "typescript-package",
        path: "packages/finance-tax-rules",
      },
      {
        id: "personal-finance",
        kind: "terraform-root",
        path: "infra/personal-finance",
      },
      {
        id: "planning-case-domain",
        kind: "typescript-package",
        path: "packages/planning-case-domain",
      },
      {
        id: "web",
        kind: "project-ui",
        path: "ui/app/_projects/personal-finance-app",
        mount_path: "/assettracker",
      },
    ]);
    expect(first.blueprint.nix).toEqual({ enabled: false });
    expect(first.blueprint.opentelemetry).toMatchObject({
      enabled: true,
      runtime: "typescript-worker",
      data_policy: {
        mode: "default-deny",
        unsafe_record_action: "drop",
      },
    });
    expect(
      first.blueprint.components.some(({ kind }) => kind === "worker"),
    ).toBe(false);
    expect(
      first.blueprint.selections
        .filter(({ layer }) =>
          [
            "web-app",
            "backend-api",
            "database",
            "observability",
            "storage",
          ].includes(layer),
        )
        .map(({ slot }) => slot),
    ).toEqual(
      expect.arrayContaining([
        "web-app.host",
        "backend-api.runtime",
        "backend-api.relational-connection",
        "database.relational-engine",
        "database.relational-host",
        "database.backup-restore",
        "observability.telemetry-protocol",
        "observability.application-telemetry",
        "storage.object-store",
      ]),
    );
  });

  it("pins the production template and inherits local task applicability", async () => {
    const [{ blueprint, contracts }, registrySource] = await Promise.all([
      productionBlueprint(),
      readFile(new URL("project-template-sources.yaml", platformRoot), "utf8"),
    ]);
    const registry = parseTemplateRegistry(registrySource);
    const selected = registry.templates.find(
      ({ id }) => id === "monorepo-project",
    );
    expect(selected).toBeDefined();
    if (!selected) throw new Error("Production template is missing");
    const template = requirePinnedTemplate(selected);
    const plan = projectPlanFromBlueprint({ blueprint, contracts, template });

    expect(template).toMatchObject({
      id: "monorepo-project",
      source: "https://github.com/Robbie-Palmer/hq.git",
      revision: "6d9f9044e7d74e50270f61eccc19001b54cd317a",
    });
    expect(plan.owned_paths).toEqual([
      "infra/personal-finance",
      "packages/finance-housing-indices",
      "packages/finance-inflation-indices",
      "packages/finance-tax-rules",
      "packages/planning-case-domain",
      "ui/app/_projects/personal-finance-app",
      "ui/content/projects/personal-finance-app",
    ]);
    expect(
      blueprint.components.flatMap(({ id, tasks }) =>
        tasks
          .filter(({ disposition }) => disposition === "not-applicable")
          .map(({ name }) => `${id}:${name}`),
      ),
    ).toEqual([]);
    expect(
      blueprint.components
        .filter(({ id }) => id !== "web")
        .flatMap(({ tasks }) => tasks)
        .every(({ disposition }) => disposition === "inherited"),
    ).toBe(true);
    expect(
      blueprint.components
        .find(({ id }) => id === "web")
        ?.tasks.every(({ disposition }) => disposition === "delegated"),
    ).toBe(true);
  });
});
