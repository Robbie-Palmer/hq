import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import {
  projectPlanFromBlueprint,
  requirePinnedTemplate,
} from "../src/profile-plan.js";
import {
  parseProjectProfile,
  resolveProjectProfile,
  type ProjectProfileContracts,
} from "../src/profile.js";

const effectiveAt = "2026-10-21T00:00:00Z";
const template = {
  id: "monorepo-project",
  source: "https://example.invalid/monorepo-project.git",
  revision: "a".repeat(40),
  checks: ["//:layout:check"],
};

function contracts(): ProjectProfileContracts {
  return {
    layout: {
      schema_version: 1,
      project_kinds: [
        { id: "application" },
        { id: "library" },
        { id: "platform" },
      ],
      projects: [],
      component_kinds: [
        {
          id: "ui",
          directory: "ui",
          mise_config_root: true,
          pnpm_workspace_package: true,
          task_ownership: "generated",
        },
        {
          id: "project-ui",
          directory: "ui/app/_projects/{project}",
          mise_config_root: false,
          pnpm_workspace_package: false,
          task_ownership: "delegated",
          delegated_task_project: "//ui",
        },
        {
          id: "worker",
          directory: "workers/{component}",
          mise_config_root: true,
          pnpm_workspace_package: true,
          task_ownership: "inherited",
        },
        {
          id: "typescript-package",
          directory: "packages/{component}",
          mise_config_root: true,
          pnpm_workspace_package: true,
          task_ownership: "inherited",
        },
        {
          id: "terraform-root",
          directory: "infra/{component}",
          mise_config_root: true,
          pnpm_workspace_package: false,
          task_ownership: "inherited",
        },
      ],
      task_contract: {
        id: "standard",
        required: [
          "install",
          "format",
          "lint",
          "typecheck-or-compile",
          "test",
          "build",
          "clean",
        ],
      },
      knowledge_graph: {
        project_index: "ui/content/projects/{project}/index.mdx",
        architecture_decisions:
          "ui/content/projects/{project}/adrs/{sequence}-{slug}.mdx",
        product_decisions:
          "ui/content/projects/{project}/pdrs/{sequence}-{slug}.mdx",
      },
    },
    platform: {
      schema_version: 1,
      project: "personal-engineering-platform",
      catalog: { records: [] },
      layers: [
        { slug: "base" },
        { slug: "typescript" },
        { slug: "observability" },
      ],
      slots: [
        {
          slug: "project.task-runner",
          kind: "technology",
          cardinality: "one",
          opinionated: true,
        },
        {
          slug: "project.primary-language",
          kind: "technology",
          cardinality: "one",
          opinionated: true,
        },
        {
          slug: "observability.telemetry-protocol",
          kind: "technology",
          cardinality: "one",
          opinionated: true,
        },
      ],
      policies: [
        {
          id: "base-task-runner",
          layer: "base",
          slot: "project.task-runner",
          mode: "required",
          decision: "personal-engineering-platform:001-mise",
          effective_from: "2026-01-01T00:00:00Z",
          prerequisites: [],
        },
        {
          id: "typescript-language",
          layer: "typescript",
          slot: "project.primary-language",
          mode: "required",
          decision: "personal-engineering-platform:002-typescript",
          effective_from: "2026-01-01T00:00:00Z",
          prerequisites: [],
        },
        {
          id: "observability-telemetry",
          layer: "observability",
          slot: "observability.telemetry-protocol",
          mode: "preferred",
          decision: "personal-engineering-platform:039-opentelemetry",
          effective_from: "2026-01-01T00:00:00Z",
          prerequisites: [
            { requirement: "instrumented-runtime" },
            { requirement: "telemetry-redaction" },
            { requirement: "bounded-exporter-failure" },
          ],
        },
      ],
      selections: [
        {
          id: "project-task-runner-mise",
          slot: "project.task-runner",
          kind: "technology",
          technology: "mise",
          status: "Accepted",
          decision: "personal-engineering-platform:001-mise",
          effective_from: "2026-01-01T00:00:00Z",
          configuration_requirements: [],
          state_requirements: [],
          operational_checks: [],
          manual_setup: [],
        },
        {
          id: "project-language-typescript",
          slot: "project.primary-language",
          kind: "technology",
          technology: "typescript",
          status: "Accepted",
          decision: "personal-engineering-platform:002-typescript",
          effective_from: "2026-01-01T00:00:00Z",
          configuration_requirements: [],
          state_requirements: [],
          operational_checks: [],
          manual_setup: [],
        },
        {
          id: "observability-opentelemetry",
          slot: "observability.telemetry-protocol",
          kind: "technology",
          technology: "opentelemetry",
          status: "Accepted",
          decision: "personal-engineering-platform:039-opentelemetry",
          effective_from: "2026-01-01T00:00:00Z",
          configuration_requirements: [{ name: "OTEL_EXPORTER_OTLP_ENDPOINT" }],
          state_requirements: [],
          operational_checks: [],
          manual_setup: [],
        },
      ],
    },
    nix: {
      schema_version: 1,
      supported_systems: ["x86_64-linux", "aarch64-darwin"],
      inputs: { locked: true, allow_unlocked_production_builds: false },
      outputs: {
        per_system: {
          "devShells.default": "required",
          formatter: "required",
        },
        top_level: { nixosModules: "when reusable" },
      },
      mise_tasks: { show: "nix-flake-show", check: "nix-flake-check" },
    },
    opentelemetry: {
      schema_version: 1,
      signals: { required: ["traces", "metrics", "logs"] },
      resource_identity: {
        required: [
          "service.namespace",
          "service.name",
          "me.robbiepalmer.project.id",
        ],
      },
      transport: {
        runtime_defaults: {
          "typescript-worker": {
            protocol: "http/protobuf",
            route: "direct",
          },
        },
      },
      semantic_conventions: { policy: "stable-only" },
      data_policy: { mode: "default-deny", unsafe_record_action: "drop" },
      cardinality: {
        max_metric_series_per_instrument: 2_000,
        max_attribute_count_per_record: 128,
        max_attribute_value_length: 4_096,
      },
      processing: { failure_mode: "fail-open" },
    },
  } as unknown as ProjectProfileContracts;
}

const examples = [
  {
    name: "small single-technology project",
    profile: {
      schema_version: 1,
      project: { id: "tiny-library", name: "Tiny library", kind: "library" },
      components: [
        { id: "tiny-library", name: "Tiny library", kind: "typescript-package" },
      ],
      layers: [{ layer: "base" }, { layer: "typescript" }],
      nix: { boundary: "none" },
      opentelemetry: { enabled: false },
    },
  },
  {
    name: "application plus infrastructure project",
    profile: {
      schema_version: 1,
      project: { id: "mixed-app", name: "Mixed app", kind: "application" },
      components: [
        { id: "api", name: "Application worker", kind: "worker" },
        { id: "edge", name: "Edge infrastructure", kind: "terraform-root" },
      ],
      layers: [
        { layer: "base" },
        { layer: "typescript" },
        {
          layer: "observability",
          slots: ["observability.telemetry-protocol"],
        },
      ],
      requirements: [
        "instrumented-runtime",
        "telemetry-redaction",
        "bounded-exporter-failure",
      ],
      nix: {
        boundary: "shared",
        flake_path: "flake.nix",
        apps: ["deploy"],
      },
      opentelemetry: { enabled: true, runtime: "typescript-worker" },
    },
  },
  {
    name: "package-producing project",
    profile: {
      schema_version: 1,
      project: { id: "package-kit", name: "Package kit", kind: "library" },
      components: [
        {
          id: "package-kit",
          name: "Package kit",
          kind: "typescript-package",
          task_exceptions: [
            { task: "clean", reason: "The workspace owns cleanup." },
          ],
        },
      ],
      layers: [{ layer: "base" }, { layer: "typescript" }],
      overrides: [
        {
          slot: "project.task-runner",
          kind: "technology",
          value: "task",
          decision: "package-kit:001-task-runner",
        },
      ],
      nix: {
        boundary: "project",
        flake_path: "packages/package-kit/flake.nix",
        packages: ["default"],
      },
      opentelemetry: { enabled: false },
    },
  },
] as const;

describe("resolved profile plan adapter", () => {
  it.each(examples)("maps the $name into the stable engine plan", ({ profile }) => {
    const currentContracts = contracts();
    const blueprint = resolveProjectProfile(
      parseProjectProfile(stringify(profile)),
      currentContracts,
      effectiveAt,
    );
    const plan = projectPlanFromBlueprint({
      blueprint,
      contracts: currentContracts,
      template,
    });

    expect(`${JSON.stringify(plan, null, 2)}\n`).toMatchSnapshot();
  });

  it("requires the trusted registry to pin a full template revision", () => {
    expect(() =>
      requirePinnedTemplate({
        id: "monorepo-project",
        source: "https://example.invalid/monorepo-project.git",
        checks: [],
      }),
    ).toThrow(/must declare an immutable revision/);
  });

  it("rejects an ambiguous Terraform render target", () => {
    const currentContracts = contracts();
    const profile = parseProjectProfile(
      stringify({
        schema_version: 1,
        project: {
          id: "multi-root-platform",
          name: "Multi-root platform",
          kind: "platform",
        },
        components: [
          { id: "foundation", name: "Foundation", kind: "terraform-root" },
          { id: "workload", name: "Workload", kind: "terraform-root" },
        ],
        layers: [{ layer: "base" }],
        nix: { boundary: "none" },
        opentelemetry: { enabled: false },
      }),
    );
    const blueprint = resolveProjectProfile(
      profile,
      currentContracts,
      effectiveAt,
    );

    expect(() =>
      projectPlanFromBlueprint({
        blueprint,
        contracts: currentContracts,
        template,
      }),
    ).toThrow(/supports one terraform-root component, found 2/);
  });

  it("owns hosted project UI without registering a nested workspace", () => {
    const currentContracts = contracts();
    const hostedFeature = parseProjectProfile(
      stringify({
        schema_version: 1,
        project: {
          id: "personal-finance-app",
          name: "Personal Finance App",
          kind: "application",
        },
        components: [
          {
            id: "web",
            name: "Asset Tracker",
            kind: "project-ui",
            mount_path: "/assettracker",
          },
        ],
        layers: [{ layer: "base" }],
        nix: { boundary: "none" },
        opentelemetry: { enabled: false },
      }),
    );
    const blueprint = resolveProjectProfile(
      hostedFeature,
      currentContracts,
      effectiveAt,
    );
    const plan = projectPlanFromBlueprint({
      blueprint,
      contracts: currentContracts,
      template,
    });

    expect(plan.owned_paths).toContain("ui/app/_projects/personal-finance-app");
    expect(plan.shared_manifest_edits).not.toContainEqual(
      expect.objectContaining({
        kind: "mise_config_root",
        value: "ui/app/_projects/personal-finance-app",
      }),
    );
    expect(plan.shared_manifest_edits).not.toContainEqual(
      expect.objectContaining({
        kind: "pnpm_workspace_package",
        value: "ui/app/_projects/personal-finance-app",
      }),
    );
  });

  it("uses current registrations as compare-before-replace values", () => {
    const currentContracts = contracts();
    const profile = parseProjectProfile(stringify(examples[0].profile));
    const blueprint = resolveProjectProfile(
      profile,
      currentContracts,
      effectiveAt,
    );
    currentContracts.layout.projects.push({
      id: "tiny-library",
      kind: "library",
      catalog_record: "system:tiny-library/library",
    });
    currentContracts.platform.catalog = {
      records: [blueprint.catalog.system],
    };

    const plan = projectPlanFromBlueprint({
      blueprint,
      contracts: currentContracts,
      template,
    });
    expect(plan.shared_manifest_edits).toContainEqual({
      kind: "repository_project",
      value: {
        id: "tiny-library",
        kind: "library",
        catalog_record: "system:tiny-library/library",
      },
      expected: {
        id: "tiny-library",
        kind: "library",
        catalog_record: "system:tiny-library/library",
      },
    });
    expect(plan.shared_manifest_edits).toContainEqual({
      kind: "catalog_record",
      value: blueprint.catalog.system,
      expected: blueprint.catalog.system,
    });
  });
});
