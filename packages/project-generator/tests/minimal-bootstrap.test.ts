import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { projectPlanFromBlueprint } from "../src/profile-plan.js";
import {
  parseProjectProfile,
  parseProjectProfileContracts,
  resolveProjectProfile,
} from "../src/profile.js";

const repositoryRoot = new URL("../../../", import.meta.url);
const contractRoot = new URL(
  "ui/content/projects/personal-engineering-platform/",
  repositoryRoot,
);
const profileUrl = new URL(
  "infra/project-modules/examples/minimal-bootstrap/project-profile.yaml",
  repositoryRoot,
);

async function resolveCanary() {
  const [profile, layout, platform, nix, opentelemetry] = await Promise.all([
    readFile(profileUrl, "utf8"),
    readFile(new URL("repository-layout.yaml", contractRoot), "utf8"),
    readFile(new URL("platform.yaml", contractRoot), "utf8"),
    readFile(new URL("nix-flake-contract.yaml", contractRoot), "utf8"),
    readFile(new URL("opentelemetry-contract.yaml", contractRoot), "utf8"),
  ]);
  return resolveProjectProfile(
    parseProjectProfile(profile),
    parseProjectProfileContracts({ layout, platform, nix, opentelemetry }),
    "2026-10-27T00:00:00Z",
  );
}

const infrastructureSlots = new Set([
  "backend-api.runtime",
  "database.preview-isolation",
  "database.relational-host",
  "delivery.ci",
  "infrastructure.state-backend",
  "security.preview-access",
  "web-app.host",
]);

describe("minimal managed-project bootstrap", () => {
  it("resolves only the requested deployable capabilities", async () => {
    const blueprint = await resolveCanary();
    const selections = new Map(
      blueprint.selections.map(({ slot, value }) => [slot, value]),
    );

    expect(blueprint.schema_version).toBe(2);
    expect(blueprint.project.id).toBe("platform-bootstrap-canary");
    expect(blueprint.components.map(({ kind }) => kind)).toEqual([
      "project-content",
      "project-ui",
    ]);
    expect(Object.fromEntries(selections)).toMatchObject({
      "delivery.ci": "github-actions",
      "web-app.host": "cloudflare-pages",
      "backend-api.runtime": "cloudflare-workers",
      "security.preview-access": "cloudflare-access",
      "database.relational-host": "neon",
      "infrastructure.state-backend": "terraform-cloud",
    });
    expect(selections.has("storage.object-store")).toBe(false);
    expect(selections.has("observability.application-telemetry")).toBe(false);
    expect(selections.has("feature-flags.provider")).toBe(false);

    const infrastructureProfile = JSON.parse(
      await readFile(
        new URL(
          "infra/project-modules/examples/minimal-bootstrap/infrastructure-profile.json",
          repositoryRoot,
        ),
        "utf8",
      ),
    ) as {
      schema_version: number;
      project: { id: string; name: string };
      selections: { slot: string; value: string }[];
    };
    expect(infrastructureProfile).toEqual({
      schema_version: blueprint.schema_version,
      project: {
        id: blueprint.project.id,
        name: blueprint.project.name,
      },
      selections: blueprint.selections
        .filter(({ slot }) => infrastructureSlots.has(slot))
        .map(({ slot, value }) => ({ slot, value })),
    });
  });

  it("feeds the same blueprint to Copier without embedding credentials", async () => {
    const blueprint = await resolveCanary();
    const contracts = parseProjectProfileContracts({
      layout: await readFile(new URL("repository-layout.yaml", contractRoot), "utf8"),
      platform: await readFile(new URL("platform.yaml", contractRoot), "utf8"),
      nix: await readFile(new URL("nix-flake-contract.yaml", contractRoot), "utf8"),
      opentelemetry: await readFile(
        new URL("opentelemetry-contract.yaml", contractRoot),
        "utf8",
      ),
    });
    const plan = projectPlanFromBlueprint({
      blueprint,
      contracts,
      template: {
        id: "monorepo-project",
        source: "https://github.com/Robbie-Palmer/hq.git",
        revision: "6d9f9044e7d74e50270f61eccc19001b54cd317a",
        checks: ["//:layout:check"],
      },
    });

    expect(plan.answers.blueprint).toEqual(blueprint);
    expect(plan.owned_paths).toEqual(blueprint.ownership.owned_paths);
    expect(JSON.stringify(plan)).not.toMatch(
      /(?:api[_-]?key|password|private[_-]?key|secret|token)["']?\s*:/i,
    );
  });
});
