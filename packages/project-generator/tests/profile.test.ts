import { readFile } from "node:fs/promises";
import { parsePlatformManifestSource } from "platform-contracts/platform-manifest";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import {
  parseProjectProfile,
  parseProjectProfileContracts,
  projectProfileSchema,
  resolveProjectProfile,
  serializeResolvedBlueprint,
  type ProjectProfile,
  type ProjectProfileContracts,
} from "../src/profile.js";

const effectiveAt = "2026-10-21T00:00:00Z";

function profile(overrides: Record<string, unknown> = {}): ProjectProfile {
  return projectProfileSchema.parse({
    schema_version: 1,
    project: { id: "sample-app", name: "Sample app", kind: "application" },
    components: [
      {
        id: "web",
        name: "Web application",
        kind: "ui",
        task_exceptions: [{ task: "clean", reason: "The workspace owns cleanup." }],
      },
      { id: "api", name: "API", kind: "worker" },
    ],
    layers: [
      { layer: "base" },
      { layer: "observability", slots: ["observability.telemetry-protocol"] },
    ],
    requirements: [
      "instrumented-runtime",
      "telemetry-redaction",
      "bounded-exporter-failure",
    ],
    overrides: [],
    nix: {
      boundary: "project",
      flake_path: "packages/sample-app/flake.nix",
      packages: ["server", "client"],
      apps: ["serve", "migrate"],
    },
    opentelemetry: { enabled: true, runtime: "typescript-worker" },
    ...overrides,
  });
}

function contracts(overrides: {
  layout?: Record<string, unknown>;
  platform?: Record<string, unknown>;
  nix?: Record<string, unknown>;
  opentelemetry?: Record<string, unknown>;
} = {}): ProjectProfileContracts {
  const layout = {
    schema_version: 1,
    project_kinds: [
      { id: "application" },
      { id: "service" },
      { id: "library" },
      { id: "data-pipeline" },
      { id: "embedded-system" },
      { id: "infrastructure" },
      { id: "platform" },
    ],
    component_kinds: [
      {
        id: "ui",
        directory: "ui",
        mise_config_root: true,
        pnpm_workspace_package: true,
      },
      {
        id: "web-feature",
        directory: "ui/features/{project}",
        mise_config_root: false,
        pnpm_workspace_package: false,
        delegated_task_project: "//ui",
      },
      {
        id: "worker",
        directory: "workers/{component}",
        mise_config_root: true,
        pnpm_workspace_package: true,
      },
      {
        id: "typescript-package",
        directory: "packages/{component}",
        mise_config_root: true,
        pnpm_workspace_package: true,
      },
      {
        id: "python-pipeline",
        directory: "ml-pipelines/{component}",
        mise_config_root: true,
        pnpm_workspace_package: false,
      },
      {
        id: "cpp-project",
        directory: "cpp/{component}",
        mise_config_root: true,
        pnpm_workspace_package: false,
      },
      {
        id: "terraform-root",
        directory: "infra/{component}",
        mise_config_root: true,
        pnpm_workspace_package: false,
      },
      {
        id: "kubernetes-component",
        directory: "homelab/k3s/components/{component}",
        mise_config_root: true,
        pnpm_workspace_package: false,
      },
      {
        id: "homelab-system",
        directory: "homelab",
        mise_config_root: true,
        pnpm_workspace_package: false,
      },
    ],
    task_contract: {
      id: "standard",
      required: ["install", "format", "lint", "typecheck-or-compile", "test", "build", "clean"],
    },
    knowledge_graph: {
      project_index: "ui/content/projects/{project}/index.mdx",
      architecture_decisions: "ui/content/projects/{project}/adrs/{sequence}-{slug}.mdx",
      product_decisions: "ui/content/projects/{project}/pdrs/{sequence}-{slug}.mdx",
    },
    ...overrides.layout,
  };
  const platform = {
    schema_version: 1,
    project: "personal-engineering-platform",
    layers: [{ slug: "base" }, { slug: "observability" }],
    slots: [
      { slug: "project.task-runner" },
      { slug: "observability.telemetry-protocol" },
    ],
    policies: [
      {
        id: "base-task-runner",
        layer: "base",
        slot: "project.task-runner",
        mode: "required",
        decision: "personal-engineering-platform:001-mise",
        effective_from: "2026-01-01T00:00:00Z",
      },
      {
        id: "observability-telemetry-protocol",
        layer: "observability",
        slot: "observability.telemetry-protocol",
        mode: "preferred",
        decision: "personal-engineering-platform:039-opentelemetry",
        effective_from: "2026-01-01T00:00:00Z",
        prerequisites: [
          { requirement: "instrumented-runtime" },
          { requirement: "telemetry-redaction" },
          { requirement: "bounded-exporter-failure" },
          { slot: "project.task-runner", technology: "Mise" },
        ],
      },
    ],
    selections: [
      {
        id: "project-task-runner-mise",
        slot: "project.task-runner",
        technology: "mise",
        status: "Accepted",
        decision: "personal-engineering-platform:001-mise",
        effective_from: "2026-01-01T00:00:00Z",
      },
      {
        id: "observability-opentelemetry",
        slot: "observability.telemetry-protocol",
        technology: "opentelemetry",
        status: "Accepted",
        decision: "personal-engineering-platform:039-opentelemetry",
        effective_from: "2026-01-01T00:00:00Z",
        configuration_requirements: [{ name: "OTEL_EXPORTER_OTLP_ENDPOINT" }],
        state_requirements: [{ name: "Exporter queue" }],
        operational_checks: [{ name: "OTel conformance", reference: "//:otel-check" }],
        manual_setup: ["Confirm telemetry retention."],
      },
    ],
    ...overrides.platform,
  };
  const nix = {
    schema_version: 1,
    supported_systems: ["x86_64-linux", "aarch64-darwin"],
    inputs: { locked: true, allow_unlocked_production_builds: false },
    outputs: {
      per_system: { "devShells.default": "required", formatter: "required" },
      top_level: { nixosModules: "when reusable" },
    },
    mise_tasks: { show: "nix-flake-show", check: "nix-flake-check" },
    ...overrides.nix,
  };
  const opentelemetry = {
    schema_version: 1,
    signals: { required: ["traces", "metrics", "logs"] },
    resource_identity: {
      required: ["service.namespace", "service.name", "me.robbiepalmer.project.id"],
    },
    transport: {
      runtime_defaults: {
        "typescript-worker": { protocol: "http/protobuf", route: "direct" },
        "python-service": { protocol: "grpc", route: "collector" },
      },
    },
    semantic_conventions: { policy: "stable-only" },
    data_policy: { mode: "default-deny", unsafe_record_action: "drop" },
    cardinality: {
      max_metric_series_per_instrument: 2000,
      max_attribute_count_per_record: 128,
      max_attribute_value_length: 4096,
    },
    processing: { failure_mode: "fail-open" },
    ...overrides.opentelemetry,
  };
  return {
    layout,
    platform: parsePlatformManifestSource(platform),
    nix,
    opentelemetry,
  } as unknown as ProjectProfileContracts;
}

describe("project profile contracts", () => {
  it("parses the repository's current platform contracts", async () => {
    const contentRoot = new URL(
      "../../../ui/content/projects/personal-engineering-platform/",
      import.meta.url,
    );
    const [layout, platform, nix, opentelemetry] = await Promise.all([
      readFile(new URL("repository-layout.yaml", contentRoot), "utf8"),
      readFile(new URL("platform.yaml", contentRoot), "utf8"),
      readFile(new URL("nix-flake-contract.yaml", contentRoot), "utf8"),
      readFile(new URL("opentelemetry-contract.yaml", contentRoot), "utf8"),
    ]);
    expect(
      parseProjectProfileContracts({ layout, platform, nix, opentelemetry })
        .layout.schema_version,
    ).toBe(1);
  });

  it("parses a versioned YAML profile and supplies collection defaults", () => {
    const parsed = parseProjectProfile(stringify({
      schema_version: 1,
      project: { id: "library-one", name: "Library one", kind: "library" },
      components: [{ id: "library-one", name: "Library one", kind: "typescript-package" }],
      layers: [{ layer: "base" }],
      nix: { boundary: "none" },
      opentelemetry: { enabled: false },
    }));
    expect(parsed.components[0]?.task_exceptions).toEqual([]);
    expect(parsed).toMatchObject({ requirements: [], overrides: [] });
  });

  it.each([
    [{ schema_version: 2 }, /schema_version/],
    [{ capabilities: { container: { base: "alpine" } } }, /not supported by project profile schema version 1/],
    [{ project: { id: "bad", name: "Bad", kind: "data-pipeline" } }, /compatible primary component/],
    [{ components: [{ id: "web", name: "One", kind: "ui" }, { id: "web", name: "Two", kind: "ui" }] }, /duplicate component ids/],
    [{ components: [{ id: "feature", name: "Feature", kind: "web-feature" }] }, /required for a web-feature/],
    [{ components: [{ id: "web", name: "Web", kind: "ui", mount_path: "/web" }] }, /only valid for a web-feature/],
    [{ components: [
      { id: "first", name: "First", kind: "web-feature", mount_path: "/same" },
      { id: "second", name: "Second", kind: "web-feature", mount_path: "/same" },
    ] }, /duplicate web feature mount paths/],
    [{ layers: [{ layer: "base" }, { layer: "base" }] }, /duplicate layers/],
    [{ requirements: ["one", "one"] }, /duplicate requirements/],
    [{ overrides: [
      { slot: "project.task-runner", kind: "technology", value: "mise", decision: "project:001-one" },
      { slot: "project.task-runner", kind: "technology", value: "other", decision: "project:002-two" },
    ] }, /duplicate override slots/],
    [{ nix: { boundary: "none", packages: ["one"] } }, /no Nix boundary/],
    [{ nix: { boundary: "project" } }, /flake_path/],
    [{ opentelemetry: { enabled: true } }, /required when OpenTelemetry is enabled/],
    [{ opentelemetry: { enabled: false, runtime: "typescript-worker" } }, /must be omitted/],
  ])("rejects invalid profiles", (replacement, expected) => {
    const replacementRecord = replacement as Record<string, unknown>;
    const raw = {
      ...profile(),
      ...replacementRecord,
      project: replacementRecord.project ?? profile().project,
    };
    expect(() => projectProfileSchema.parse(raw)).toThrow(expected);
  });
});

describe("project profile resolution", () => {
  it("resolves stable repository, task, catalog, Nix, and telemetry declarations", () => {
    const blueprint = resolveProjectProfile(profile(), contracts(), effectiveAt);
    expect(blueprint.project.stable_id).toBe("project:sample-app");
    expect(blueprint.components.map(({ stable_id }) => stable_id)).toEqual([
      "component:sample-app/api",
      "component:sample-app/web",
    ]);
    expect(blueprint.components[1]?.tasks).toContainEqual({
      name: "clean",
      disposition: "not-applicable",
      reason: "The workspace owns cleanup.",
    });
    expect(blueprint.repository_paths).toEqual({
      copier_answers: ".copier/projects/sample-app.yml",
      project_index: "ui/content/projects/sample-app/index.mdx",
      architecture_decisions: "ui/content/projects/sample-app/adrs/{sequence}-{slug}.mdx",
      product_decisions: "ui/content/projects/sample-app/pdrs/{sequence}-{slug}.mdx",
    });
    expect(blueprint.selections.map(({ id }) => id)).toEqual([
      "observability-opentelemetry",
      "project-task-runner-mise",
    ]);
    expect(blueprint.catalog.system).toMatchObject({
      id: "system:sample-app/application",
      source_paths: ["ui", "workers/api"],
    });
    expect(blueprint.nix).toMatchObject({
      enabled: true,
      locked_inputs: true,
      supported_systems: ["aarch64-darwin", "x86_64-linux"],
      packages: ["client", "server"],
      apps: ["migrate", "serve"],
    });
    expect(blueprint.opentelemetry).toMatchObject({
      enabled: true,
      runtime: "typescript-worker",
      resource_attributes: { "me.robbiepalmer.project.id": "project:sample-app" },
      transport: { protocol: "http/protobuf", route: "direct" },
    });
    expect(blueprint.manual_checkpoints).toEqual([
      "Configure OTEL_EXPORTER_OTLP_ENDPOINT for observability-opentelemetry",
      "Confirm telemetry retention.",
      "Provision Exporter queue for observability-opentelemetry",
      "Verify OTel conformance: //:otel-check",
    ]);
  });

  it("serializes equivalent profiles byte-for-byte regardless of source ordering", () => {
    const first = profile();
    const second = projectProfileSchema.parse({
      ...first,
      components: [...first.components].reverse(),
      layers: [...first.layers].reverse(),
      requirements: [...first.requirements].reverse(),
      nix: { ...first.nix, packages: [...first.nix.packages].reverse() },
    });
    expect(serializeResolvedBlueprint(resolveProjectProfile(first, contracts(), effectiveAt))).toBe(
      serializeResolvedBlueprint(resolveProjectProfile(second, contracts(), effectiveAt)),
    );
  });

  it("uses justified overrides and supports profiles without Nix or telemetry", () => {
    const input = profile({
      overrides: [{
        slot: "project.task-runner",
        kind: "technology",
        value: "task",
        decision: "sample-app:001-task-runner",
      }],
      nix: { boundary: "none" },
      opentelemetry: { enabled: false },
      layers: [{ layer: "base" }],
    });
    const blueprint = resolveProjectProfile(input, contracts(), effectiveAt);
    expect(blueprint.selections.find(({ slot }) => slot === "project.task-runner")).toMatchObject({
      source: "override",
      value: "task",
      decision: "sample-app:001-task-runner",
    });
    expect(blueprint.nix).toEqual({ enabled: false });
    expect(blueprint.opentelemetry).toEqual({ enabled: false });
  });

  it("resolves a project-owned feature hosted by the shared UI", () => {
    const input = profile({
      project: {
        id: "personal-finance-app",
        name: "Personal Finance App",
        kind: "application",
      },
      components: [
        {
          id: "web",
          name: "Asset Tracker",
          kind: "web-feature",
          mount_path: "/assettracker",
        },
      ],
      layers: [{ layer: "base" }],
      requirements: [],
      nix: { boundary: "none" },
      opentelemetry: { enabled: false },
    });

    const blueprint = resolveProjectProfile(input, contracts(), effectiveAt);

    expect(blueprint.components).toContainEqual(
      expect.objectContaining({
        stable_id: "component:personal-finance-app/web",
        path: "ui/features/personal-finance-app",
        mount_path: "/assettracker",
      }),
    );
    expect(blueprint.components[0]?.tasks).toContainEqual({
      name: "typecheck-or-compile",
      disposition: "delegated",
      target: "//ui:typecheck",
    });
    expect(blueprint.catalog.components[0]).toMatchObject({
      id: "component:personal-finance-app/web",
      source_paths: ["ui/features/personal-finance-app"],
      mount_path: "/assettracker",
    });
    expect(blueprint.ownership.owned_paths).toContain(
      "ui/features/personal-finance-app",
    );
  });

  it.each([
    [profile({ layers: [{ layer: "future" }] }), contracts(), /Unknown current layer 'future'/],
    [profile({ layers: [{ layer: "base", slots: ["future.slot"] }] }), contracts(), /Unknown current slot 'future.slot'/],
    [profile({ requirements: [] }), contracts(), /undeclared operational prerequisite/],
    [profile({ overrides: [{ slot: "observability.telemetry-protocol", kind: "policy", value: "custom", decision: "sample-app:001-custom" }] }), contracts(), /kind does not match/],
    [profile({ overrides: [{ slot: "project.task-runner", kind: "technology", value: "mise", decision: "sample-app:001-custom" }], layers: [{ layer: "observability", slots: ["observability.telemetry-protocol"] }] }), contracts(), /not referenced by an active profile policy/],
  ])("rejects profiles that contradict current contracts", (input, currentContracts, expected) => {
    expect(() => resolveProjectProfile(input, currentContracts, effectiveAt)).toThrow(expected);
  });

  it("rejects duplicate resolved paths", () => {
    const input = profile({
      components: [
        { id: "first", name: "First", kind: "ui" },
        { id: "second", name: "Second", kind: "ui" },
      ],
    });
    expect(() => resolveProjectProfile(input, contracts(), effectiveAt)).toThrow(/duplicate repository path 'ui'/);
  });

  it("rejects unresolved slot prerequisites", () => {
    const current = contracts({ platform: {
      schema_version: 1,
      layers: [{ slug: "base" }, { slug: "observability" }],
      slots: [{ slug: "project.task-runner" }, { slug: "observability.telemetry-protocol" }],
      policies: [{
        id: "base-task-runner",
        layer: "base",
        slot: "project.task-runner",
        mode: "required",
        decision: "personal-engineering-platform:001-mise",
        effective_from: "2026-01-01T00:00:00Z",
        prerequisites: [{ slot: "observability.telemetry-protocol" }],
      }],
      selections: [],
    } });
    expect(() => resolveProjectProfile(profile(), current, effectiveAt)).toThrow(/Unmet current slot prerequisites/);
  });

  it("rejects ambiguous single-cardinality selections and absent transport defaults", () => {
    const base = contracts();
    const duplicate = contracts({ platform: {
      ...base.platform,
      selections: [...base.platform.selections, {
        ...base.platform.selections[0],
        id: "project-task-runner-other",
        technology: "other",
      }],
    } });
    expect(() => resolveProjectProfile(profile(), duplicate, effectiveAt)).toThrow(/exactly one current selection/);

    const noTransport = contracts({ opentelemetry: {
      ...base.opentelemetry,
      transport: { runtime_defaults: {} },
    } });
    expect(() => resolveProjectProfile(profile(), noTransport, effectiveAt)).toThrow(/has no current transport default/);
  });

  it("requires an explicit valid resolution instant", () => {
    expect(() => resolveProjectProfile(profile(), contracts(), "today")).toThrow();
  });
});
