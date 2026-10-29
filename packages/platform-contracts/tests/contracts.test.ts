import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseFeatureFlagContract } from "../src/feature-flags";
import { parseNixFlakeContract } from "../src/nix-flake";
import { parseOpenTelemetryContract } from "../src/opentelemetry";
import { parseContract } from "../src/parse";
import { parsePlatformManifestSource } from "../src/platform-manifest";
import { parseRepositoryLayoutContract } from "../src/repository-layout";

const contractRoot = new URL(
  "../../../ui/content/projects/personal-engineering-platform/",
  import.meta.url,
);

async function load(name: string): Promise<unknown> {
  return parse(await readFile(new URL(name, contractRoot), "utf8"));
}

describe("shared platform contract parsers", () => {
  it("parses every current production contract", async () => {
    const [layout, platform, nix, opentelemetry, featureFlags] =
      await Promise.all([
        load("repository-layout.yaml"),
        load("platform.yaml"),
        load("nix-flake-contract.yaml"),
        load("opentelemetry-contract.yaml"),
        load("feature-flag-contract.yaml"),
      ]);

    expect(parseRepositoryLayoutContract(layout).schema_version).toBe(1);
    expect(parsePlatformManifestSource(platform).schema_version).toBe(1);
    expect(parseNixFlakeContract(nix).contract).toBe("nix-flake");
    expect(parseOpenTelemetryContract(opentelemetry).contract).toBe(
      "opentelemetry",
    );
    expect(parseFeatureFlagContract(featureFlags).contract).toBe(
      "feature-flags",
    );
  });

  it("normalizes technology identities at the source boundary", () => {
    const parsed = parsePlatformManifestSource({
      schema_version: 1,
      project: "platform",
      layers: [
        {
          slug: "typescript",
          activated_by: {
            slot: "project.primary-language",
            technology: "TypeScript",
          },
        },
      ],
      slots: [{ slug: "project.primary-language" }],
      policies: [],
      selections: [
        {
          id: "typescript-default",
          slot: "project.primary-language",
          technology: "TypeScript",
          status: "Accepted",
          decision: "platform:001-typescript",
          effective_from: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(parsed.layers[0]?.activated_by?.technology).toBe("typescript");
    expect(parsed.selections[0]?.technology).toBe("typescript");
  });

  it("preserves task delegation in legacy version 1 layouts", () => {
    const parsed = parseRepositoryLayoutContract({
      schema_version: 1,
      project_kinds: [],
      projects: [],
      component_kinds: [
        {
          id: "project-ui",
          directory: "ui/app/_projects/{project}",
          mise_config_root: false,
          delegated_task_project: "//ui",
        },
        {
          id: "package",
          directory: "packages/{component}",
        },
      ],
      task_contract: { id: "standard", required: [] },
      knowledge_graph: {
        project_index: "projects/{project}",
        architecture_decisions: "adrs/{project}",
        product_decisions: "decisions/{project}",
      },
      shared_manifests: [],
      workspace_policy: {
        node_workspace: "pnpm-workspace.yaml",
        node_lockfile: "pnpm-lock.yaml",
        standalone_node_roots: [],
        approved_npm_lockfiles: [],
        local_mise_roots: [],
      },
    });

    expect(parsed.component_kinds).toEqual([
      expect.objectContaining({
        id: "project-ui",
        task_ownership: "delegated",
        delegated_task_project: "//ui",
      }),
      expect.objectContaining({
        id: "package",
        task_ownership: "generated",
      }),
    ]);
  });

  it("infers policy selections from their value", () => {
    const parsed = parsePlatformManifestSource({
      schema_version: 1,
      project: "platform",
      layers: [],
      slots: [{ slug: "governance.visibility", kind: "policy" }],
      policies: [],
      selections: [
        {
          id: "public-source",
          slot: "governance.visibility",
          value: "Public source",
          status: "Accepted",
          decision: "platform:001-public-source",
          effective_from: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(parsed.selections[0]).toMatchObject({
      kind: "policy",
      value: "Public source",
    });
  });

  it.each([
    { kind: "technology" },
    { kind: "policy" },
  ])("rejects a selection missing its kind's value", (selection) => {
    expect(() =>
      parsePlatformManifestSource({
        schema_version: 1,
        project: "platform",
        layers: [],
        slots: [{ slug: "project.selection" }],
        policies: [],
        selections: [
          {
            id: "invalid-selection",
            slot: "project.selection",
            status: "Accepted",
            decision: "platform:001-selection",
            effective_from: "2026-01-01T00:00:00Z",
            ...selection,
          },
        ],
      }),
    ).toThrow(/Invalid/);
  });

  it("keeps an explicit selection kind authoritative", () => {
    const parsed = parsePlatformManifestSource({
      schema_version: 1,
      project: "platform",
      layers: [],
      slots: [{ slug: "project.selection" }],
      policies: [],
      selections: [
        {
          id: "typescript-selection",
          slot: "project.selection",
          kind: "technology",
          technology: "TypeScript",
          value: "Public source",
          status: "Accepted",
          decision: "platform:001-selection",
          effective_from: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(parsed.selections[0]).toMatchObject({
      kind: "technology",
      technology: "typescript",
    });
  });

  it.each([
    [parseRepositoryLayoutContract, {}],
    [parsePlatformManifestSource, {}],
    [parseNixFlakeContract, {}],
    [parseOpenTelemetryContract, {}],
    [parseFeatureFlagContract, {}],
  ])("reports invalid contract fields", (parser, value) => {
    expect(() => parser(value)).toThrow(/Invalid/);
  });

  it("labels a root-level parse failure", () => {
    expect(() => parseContract({}, z.never(), "example contract")).toThrow(
      "example contract: Invalid input",
    );
  });
});
