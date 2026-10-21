import { parse } from "yaml";
import { z } from "zod";
import {
  type NixFlakeContract,
  parseNixFlakeContract,
} from "platform-contracts/nix-flake";
import {
  type OpenTelemetryContract,
  openTelemetryRuntimeSchema,
  parseOpenTelemetryContract,
} from "platform-contracts/opentelemetry";
import {
  parsePlatformManifestSource,
  type PlatformManifestSource,
} from "platform-contracts/platform-manifest";
import {
  parseRepositoryLayoutContract,
  type RepositoryLayoutContract,
} from "platform-contracts/repository-layout";
import {
  compareUtcInstants,
  isUtcInstant,
  UTC_INSTANT_PATTERN,
} from "ts-base/dates";
import {
  compareStrings,
  LOWERCASE_KEBAB_CASE_PATTERN,
  normalizeSlug,
} from "ts-base/strings";

const SLOT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ADR_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PROJECT_PROFILE_SCHEMA_VERSION = 1;
export const RESOLVED_BLUEPRINT_SCHEMA_VERSION = 1;

const slugSchema = z.string().regex(LOWERCASE_KEBAB_CASE_PATTERN);
const slotSchema = z.string().regex(SLOT_PATTERN);
const adrRefSchema = z.string().regex(ADR_REF_PATTERN);
const utcInstantSchema = z.string().regex(UTC_INSTANT_PATTERN).refine(
  isUtcInstant,
  "must be a valid RFC 3339 UTC instant",
);

const technologySlugSchema = z
  .string()
  .min(1)
  .transform(normalizeSlug)
  .pipe(slugSchema);

const projectKindSchema = z.enum([
  "application",
  "service",
  "library",
  "data-pipeline",
  "embedded-system",
  "infrastructure",
  "platform",
]);

const componentKindSchema = z.enum([
  "ui",
  "web-feature",
  "worker",
  "typescript-package",
  "python-pipeline",
  "cpp-project",
  "terraform-root",
  "kubernetes-component",
  "homelab-system",
]);

const taskNameSchema = z.enum([
  "install",
  "format",
  "lint",
  "typecheck-or-compile",
  "test",
  "build",
  "clean",
]);

const webMountPathSchema = z
  .string()
  .regex(/^\/[a-z0-9]+(?:[a-z0-9/-]*[a-z0-9])?$/);

const taskExceptionSchema = z
  .object({
    task: taskNameSchema,
    reason: z.string().min(1),
  })
  .strict();

const componentSchema = z
  .object({
    id: slugSchema,
    kind: componentKindSchema,
    name: z.string().min(1),
    mount_path: webMountPathSchema.optional(),
    task_exceptions: z.array(taskExceptionSchema).default([]),
  })
  .strict()
  .superRefine((component, context) => {
    if (component.kind === "web-feature" && component.mount_path === undefined) {
      context.addIssue({
        code: "custom",
        path: ["mount_path"],
        message: "is required for a web-feature component",
      });
    }
    if (component.kind !== "web-feature" && component.mount_path !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["mount_path"],
        message: "is only valid for a web-feature component",
      });
    }
    addDuplicateIssues(
      component.task_exceptions.map(({ task }) => task),
      `component '${component.id}' task exceptions`,
      context,
    );
  });

const layerUseSchema = z
  .object({
    layer: slugSchema,
    slots: z.array(slotSchema).default([]),
  })
  .strict()
  .superRefine((use, context) => {
    addDuplicateIssues(use.slots, `layer '${use.layer}' slots`, context);
  });

const overrideSchema = z.discriminatedUnion("kind", [
  z
    .object({
      slot: slotSchema,
      kind: z.literal("technology"),
      value: technologySlugSchema,
      decision: adrRefSchema,
    })
    .strict(),
  z
    .object({
    slot: slotSchema,
    kind: z.literal("policy"),
    value: z.string().min(1),
    decision: adrRefSchema,
  })
    .strict(),
]);

const nixProfileSchema = z
  .object({
    boundary: z.enum(["none", "shared", "project"]),
    flake_path: z.string().min(1).optional(),
    packages: z.array(slugSchema).default([]),
    apps: z.array(slugSchema).default([]),
  })
  .strict()
  .superRefine((nix, context) => {
    if (nix.boundary === "none" && (nix.flake_path || nix.packages.length || nix.apps.length)) {
      context.addIssue({
        code: "custom",
        message: "a project with no Nix boundary cannot declare a flake path, packages, or apps",
      });
    }
    if (nix.boundary !== "none" && !nix.flake_path) {
      context.addIssue({
        code: "custom",
        path: ["flake_path"],
        message: "is required for a shared or project Nix boundary",
      });
    }
    addDuplicateIssues(nix.packages, "Nix packages", context);
    addDuplicateIssues(nix.apps, "Nix apps", context);
  });

const otelProfileSchema = z
  .object({
    enabled: z.boolean(),
    runtime: openTelemetryRuntimeSchema.optional(),
  })
  .strict()
  .superRefine((otel, context) => {
    if (otel.enabled !== (otel.runtime !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["runtime"],
        message: otel.enabled
          ? "is required when OpenTelemetry is enabled"
          : "must be omitted when OpenTelemetry is disabled",
      });
    }
  });

const unsupportedCapabilitiesSchema = z
  .record(z.string(), z.unknown())
  .superRefine((capabilities, context) => {
    for (const capability of Object.keys(capabilities)) {
      context.addIssue({
        code: "custom",
        path: [capability],
        message: `capability '${capability}' is not supported by project profile schema version 1`,
      });
    }
  });

const projectProfileFieldsSchema = z
  .object({
    schema_version: z.literal(PROJECT_PROFILE_SCHEMA_VERSION),
    project: z
      .object({
        id: slugSchema,
        name: z.string().min(1),
        kind: projectKindSchema,
      })
      .strict(),
    components: z.array(componentSchema).min(1),
    layers: z.array(layerUseSchema).min(1),
    requirements: z.array(slugSchema).default([]),
    overrides: z.array(overrideSchema).default([]),
    nix: nixProfileSchema,
    opentelemetry: otelProfileSchema,
    capabilities: unsupportedCapabilitiesSchema.optional(),
  })
  .strict();

type ProjectProfileInput = z.infer<typeof projectProfileFieldsSchema>;

function validateProfile(profile: ProjectProfileInput, context: z.RefinementCtx): void {
  addDuplicateIssues(
    profile.components.map(({ id }) => id),
    "component ids",
    context,
  );
  addDuplicateIssues(
    profile.components.flatMap(({ mount_path }) =>
      mount_path === undefined ? [] : [mount_path],
    ),
    "web feature mount paths",
    context,
  );
  addDuplicateIssues(
    profile.layers.map(({ layer }) => layer),
    "layers",
    context,
  );
  addDuplicateIssues(profile.requirements, "requirements", context);
  addDuplicateIssues(
    profile.overrides.map(({ slot }) => slot),
    "override slots",
    context,
  );

  const compatibleKinds: Record<z.infer<typeof projectKindSchema>, readonly z.infer<typeof componentKindSchema>[]> = {
    application: ["ui", "web-feature", "worker"],
    service: ["worker", "python-pipeline"],
    library: ["typescript-package", "cpp-project"],
    "data-pipeline": ["python-pipeline"],
    "embedded-system": ["cpp-project"],
    infrastructure: ["terraform-root", "kubernetes-component", "homelab-system"],
    platform: componentKindSchema.options,
  };
  if (!profile.components.some(({ kind }) => compatibleKinds[profile.project.kind].includes(kind))) {
    context.addIssue({
      code: "custom",
      path: ["components"],
      message: `project kind '${profile.project.kind}' needs at least one compatible primary component`,
    });
  }
}

export const projectProfileSchema = projectProfileFieldsSchema.superRefine(validateProfile);
export type ProjectProfile = z.infer<typeof projectProfileSchema>;

export interface ProjectProfileContracts {
  layout: Pick<
    RepositoryLayoutContract,
    | "schema_version"
    | "project_kinds"
    | "projects"
    | "component_kinds"
    | "task_contract"
    | "knowledge_graph"
  >;
  platform: PlatformManifestSource;
  nix: {
    schema_version: NixFlakeContract["schema_version"];
    supported_systems: NixFlakeContract["supported_systems"];
    inputs: Pick<
      NixFlakeContract["inputs"],
      "locked" | "allow_unlocked_production_builds"
    >;
    outputs: NixFlakeContract["outputs"];
    mise_tasks: NixFlakeContract["mise_tasks"];
  };
  opentelemetry: {
    schema_version: OpenTelemetryContract["schema_version"];
    signals: Pick<OpenTelemetryContract["signals"], "required">;
    resource_identity: Pick<OpenTelemetryContract["resource_identity"], "required">;
    transport: {
      runtime_defaults: Partial<OpenTelemetryContract["transport"]["runtime_defaults"]>;
    };
    semantic_conventions: Pick<OpenTelemetryContract["semantic_conventions"], "policy">;
    data_policy: Pick<OpenTelemetryContract["data_policy"], "mode" | "unsafe_record_action"> & Record<string, unknown>;
    cardinality: Pick<
      OpenTelemetryContract["cardinality"],
      "max_metric_series_per_instrument" | "max_attribute_count_per_record" | "max_attribute_value_length"
    > & Record<string, unknown>;
    processing: Pick<OpenTelemetryContract["processing"], "failure_mode">;
  };
}

interface ResolvedSelection {
  readonly id: string;
  readonly layer: string;
  readonly slot: string;
  readonly kind: "technology" | "policy";
  readonly value: string;
  readonly source: "default" | "override";
  readonly decision: string;
}

export interface ResolvedProjectBlueprint {
  readonly schema_version: 1;
  readonly profile_schema_version: 1;
  readonly effective_at: string;
  readonly project: {
    readonly id: string;
    readonly stable_id: string;
    readonly name: string;
    readonly kind: string;
  };
  readonly components: readonly {
    readonly id: string;
    readonly stable_id: string;
    readonly name: string;
    readonly kind: string;
    readonly path: string;
    readonly mount_path?: string;
    readonly tasks: readonly {
      readonly name: string;
      readonly disposition: "generated" | "delegated" | "not-applicable";
      readonly reason?: string;
      readonly target?: string;
    }[];
  }[];
  readonly repository_paths: {
    readonly copier_answers: string;
    readonly project_index: string;
    readonly architecture_decisions: string;
    readonly product_decisions: string;
  };
  readonly selections: readonly ResolvedSelection[];
  readonly catalog: {
    readonly system: Record<string, unknown>;
    readonly components: readonly Record<string, unknown>[];
  };
  readonly ownership: {
    readonly owned_paths: readonly string[];
    readonly structural_edits: readonly string[];
  };
  readonly nix: Record<string, unknown>;
  readonly opentelemetry: Record<string, unknown>;
  readonly manual_checkpoints: readonly string[];
}

function addDuplicateIssues(values: readonly string[], label: string, context: z.RefinementCtx): void {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) context.addIssue({ code: "custom", message: `duplicate ${label}: '${duplicate}'` });
}

export function parseProjectProfile(source: string): ProjectProfile {
  return projectProfileSchema.parse(parse(source));
}

export function parseProjectProfileContracts(sources: {
  layout: string;
  platform: string;
  nix: string;
  opentelemetry: string;
}): ProjectProfileContracts {
  return {
    layout: parseRepositoryLayoutContract(parse(sources.layout)),
    platform: parsePlatformManifestSource(parse(sources.platform)),
    nix: parseNixFlakeContract(parse(sources.nix)),
    opentelemetry: parseOpenTelemetryContract(parse(sources.opentelemetry)),
  };
}

function isEffectiveAt(period: { effective_from: string; effective_until?: string }, instant: string): boolean {
  return (
    compareUtcInstants(period.effective_from, instant) <= 0 &&
    (period.effective_until === undefined ||
      compareUtcInstants(instant, period.effective_until) < 0)
  );
}

function substitutePath(template: string, values: Record<string, string>): string {
  return template.replaceAll(/\{([a-z_]+)\}/g, (_, key: string) => {
    const value = values[key];
    if (!value) throw new Error(`Path template references unknown value '${key}'`);
    return value;
  });
}

function validateAgainstContracts(profile: ProjectProfile, contracts: ProjectProfileContracts): void {
  const kinds = new Set(contracts.layout.project_kinds.map(({ id }) => id));
  if (!kinds.has(profile.project.kind)) throw new Error(`Unknown current project kind '${profile.project.kind}'`);
  const componentKinds = new Set(contracts.layout.component_kinds.map(({ id }) => id));
  for (const component of profile.components) {
    if (!componentKinds.has(component.kind)) throw new Error(`Unknown current component kind '${component.kind}'`);
  }
  const layers = new Set(contracts.platform.layers.map(({ slug }) => slug));
  const slots = new Set(contracts.platform.slots.map(({ slug }) => slug));
  for (const use of profile.layers) {
    if (!layers.has(use.layer)) throw new Error(`Unknown current layer '${use.layer}'`);
    for (const slot of use.slots) {
      if (!slots.has(slot)) throw new Error(`Unknown current slot '${slot}'`);
    }
  }
}

function resolveComponents(profile: ProjectProfile, contracts: ProjectProfileContracts) {
  const componentKinds = new Map(
    contracts.layout.component_kinds.map((kind) => [kind.id, kind]),
  );
  const requiredTasks = taskNameSchema.array().parse(
    contracts.layout.task_contract.required,
  );
  const components = profile.components.map((component) => {
    const componentKind = componentKinds.get(component.kind);
    if (!componentKind) {
      throw new Error(
        `No directory template for component kind '${component.kind}'`,
      );
    }
    const componentPath = substitutePath(componentKind.directory, {
      component: component.id,
      project: profile.project.id,
    });
    const exceptions = new Map(component.task_exceptions.map((exception) => [exception.task, exception.reason]));
    return {
      id: component.id,
      stable_id: `component:${profile.project.id}/${component.id}`,
      name: component.name,
      kind: component.kind,
      path: componentPath,
      ...(component.mount_path === undefined
        ? {}
        : { mount_path: component.mount_path }),
      tasks: requiredTasks.toSorted(compareStrings).map((name) => {
        const reason = exceptions.get(name);
        if (reason !== undefined) {
          return { name, disposition: "not-applicable" as const, reason };
        }
        if (componentKind.delegated_task_project) {
          const taskName =
            name === "typecheck-or-compile" ? "typecheck" : name;
          return {
            name,
            disposition: "delegated" as const,
            target: `${componentKind.delegated_task_project}:${taskName}`,
          };
        }
        return { name, disposition: "generated" as const };
      }),
    };
  }).toSorted((left, right) => left.id.localeCompare(right.id, "en"));
  const duplicatePath = components.find((candidate, index) => components.findIndex(({ path: value }) => value === candidate.path) !== index);
  if (duplicatePath) throw new Error(`Components resolve to duplicate repository path '${duplicatePath.path}'`);
  return components;
}

function selectedValue(selection: PlatformManifestSource["selections"][number]): string {
  const value = selection.kind === "technology" ? selection.technology : selection.value;
  if (!value) throw new Error(`Selection '${selection.id}' has no ${selection.kind} value`);
  return value;
}

type PlatformPolicy = ProjectProfileContracts["platform"]["policies"][number];
type PlatformSelection = ProjectProfileContracts["platform"]["selections"][number];
type SlotDefinition = ProjectProfileContracts["platform"]["slots"][number];
type ProfileOverride = ProjectProfile["overrides"][number];

interface SelectionResolutionState {
  readonly profile: ProjectProfile;
  readonly contracts: ProjectProfileContracts;
  readonly effectiveAt: string;
  readonly overrides: ReadonlyMap<string, ProfileOverride>;
  readonly requirements: ReadonlySet<string>;
  readonly slotDefinitions: ReadonlyMap<string, SlotDefinition>;
  readonly resolvedValues: Map<string, Set<string>>;
  readonly resolved: ResolvedSelection[];
  readonly checkpoints: Set<string>;
}

function activePolicies(
  profile: ProjectProfile,
  contracts: ProjectProfileContracts,
  effectiveAt: string,
): PlatformPolicy[] {
  const layerUses = new Map(
    profile.layers.map((use) => [use.layer, new Set(use.slots)]),
  );
  return contracts.platform.policies
    .filter((policy) => {
      const selectedSlots = layerUses.get(policy.layer);
      return (
        selectedSlots !== undefined &&
        isEffectiveAt(policy, effectiveAt) &&
        (policy.mode === "required" || selectedSlots.has(policy.slot))
      );
    })
    .toSorted((left, right) => left.slot.localeCompare(right.slot, "en"));
}

function validateOverrides(
  profile: ProjectProfile,
  policies: readonly PlatformPolicy[],
  slots: ReadonlyMap<string, SlotDefinition>,
): void {
  const policySlots = new Set(policies.map(({ slot }) => slot));
  for (const override of profile.overrides) {
    if (!policySlots.has(override.slot)) {
      throw new Error(
        `Override '${override.slot}' is not referenced by an active profile policy`,
      );
    }
    if (slots.get(override.slot)?.kind !== override.kind) {
      throw new Error(
        `Override '${override.slot}' kind does not match the current slot kind`,
      );
    }
  }
}

function assertOperationalPrerequisites(
  policy: PlatformPolicy,
  requirements: ReadonlySet<string>,
): void {
  const missing = policy.prerequisites.find(
    (prerequisite) =>
      "requirement" in prerequisite &&
      !requirements.has(prerequisite.requirement),
  );
  if (missing && "requirement" in missing) {
    throw new Error(
      `Policy '${policy.id}' requires undeclared operational prerequisite '${missing.requirement}'`,
    );
  }
}

function hasUnmetSlotPrerequisite(
  policy: PlatformPolicy,
  resolvedValues: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  return policy.prerequisites.some((prerequisite) => {
    if (!("slot" in prerequisite)) return false;
    const values = resolvedValues.get(prerequisite.slot);
    return (
      !values ||
      (prerequisite.technology !== undefined &&
        !values.has(prerequisite.technology))
    );
  });
}

function effectiveDefaults(
  policy: PlatformPolicy,
  state: SelectionResolutionState,
): PlatformSelection[] {
  return state.contracts.platform.selections.filter(
    (selection) =>
      selection.slot === policy.slot &&
      selection.status === "Accepted" &&
      isEffectiveAt(selection, state.effectiveAt),
  );
}

function resolvedPolicySelections(
  policy: PlatformPolicy,
  state: SelectionResolutionState,
  defaults: readonly PlatformSelection[],
): ResolvedSelection[] {
  const override = state.overrides.get(policy.slot);
  if (override) {
    return [
      {
        id: `override-${state.profile.project.id}-${policy.slot.replaceAll(".", "-")}`,
        layer: policy.layer,
        slot: policy.slot,
        kind: override.kind,
        value: override.value,
        source: "override",
        decision: override.decision,
      },
    ];
  }
  return defaults.map((selection) => ({
    id: selection.id,
    layer: policy.layer,
    slot: policy.slot,
    kind: selection.kind,
    value: selectedValue(selection),
    source: "default",
    decision: selection.decision,
  }));
}

function validateSelectionCardinality(
  policy: PlatformPolicy,
  selected: readonly ResolvedSelection[],
  slots: ReadonlyMap<string, SlotDefinition>,
): void {
  const slot = slots.get(policy.slot);
  if (!slot) {
    throw new Error(
      `Policy '${policy.id}' references unknown current slot '${policy.slot}'`,
    );
  }
  if (slot.cardinality === "one" && selected.length !== 1) {
    throw new Error(
      `Policy '${policy.id}' must resolve exactly one current selection`,
    );
  }
  if (slot.cardinality === "many" && slot.opinionated && !selected.length) {
    throw new Error(
      `Policy '${policy.id}' must resolve at least one current selection`,
    );
  }
}

function addResolvedSelections(
  selected: readonly ResolvedSelection[],
  state: SelectionResolutionState,
): void {
  for (const item of selected) {
    state.resolved.push(item);
    const values = state.resolvedValues.get(item.slot) ?? new Set<string>();
    values.add(item.value);
    state.resolvedValues.set(item.slot, values);
  }
}

function addSelectionCheckpoints(
  selections: readonly PlatformSelection[],
  checkpoints: Set<string>,
): void {
  for (const selection of selections) {
    for (const requirement of selection.configuration_requirements) {
      checkpoints.add(`Configure ${requirement.name} for ${selection.id}`);
    }
    for (const requirement of selection.state_requirements) {
      checkpoints.add(`Provision ${requirement.name} for ${selection.id}`);
    }
    for (const check of selection.operational_checks) {
      checkpoints.add(`Verify ${check.name}: ${check.reference}`);
    }
    for (const step of selection.manual_setup) checkpoints.add(step);
  }
}

function resolvePolicy(
  policy: PlatformPolicy,
  state: SelectionResolutionState,
): boolean {
  assertOperationalPrerequisites(policy, state.requirements);
  if (hasUnmetSlotPrerequisite(policy, state.resolvedValues)) return false;
  const defaults = effectiveDefaults(policy, state);
  const selected = resolvedPolicySelections(policy, state, defaults);
  validateSelectionCardinality(policy, selected, state.slotDefinitions);
  addResolvedSelections(selected, state);
  if (!state.overrides.has(policy.slot)) {
    addSelectionCheckpoints(defaults, state.checkpoints);
  }
  return true;
}

function resolveSelections(
  profile: ProjectProfile,
  contracts: ProjectProfileContracts,
  effectiveAt: string,
): { selections: ResolvedSelection[]; checkpoints: string[] } {
  const slotDefinitions = new Map(contracts.platform.slots.map((slot) => [slot.slug, slot]));
  const policies = activePolicies(profile, contracts, effectiveAt);
  validateOverrides(profile, policies, slotDefinitions);
  const state: SelectionResolutionState = {
    profile,
    contracts,
    effectiveAt,
    overrides: new Map(profile.overrides.map((override) => [override.slot, override])),
    requirements: new Set(profile.requirements),
    slotDefinitions,
    resolvedValues: new Map(),
    resolved: [],
    checkpoints: new Set(),
  };
  let pending = [...policies];
  while (pending.length) {
    const next: typeof pending = [];
    for (const policy of pending) {
      if (!resolvePolicy(policy, state)) next.push(policy);
    }
    if (next.length === pending.length) {
      throw new Error(`Unmet current slot prerequisites for: ${next.map(({ id }) => id).join(", ")}`);
    }
    pending = next;
  }
  return {
    selections: state.resolved.toSorted((left, right) => left.slot.localeCompare(right.slot, "en") || left.value.localeCompare(right.value, "en")),
    checkpoints: Array.from(state.checkpoints).toSorted(compareStrings),
  };
}

export function resolveProjectProfile(
  profile: ProjectProfile,
  contracts: ProjectProfileContracts,
  effectiveAt: string,
): ResolvedProjectBlueprint {
  const instant = utcInstantSchema.parse(effectiveAt);
  validateAgainstContracts(profile, contracts);
  const components = resolveComponents(profile, contracts);
  const { selections, checkpoints } = resolveSelections(profile, contracts, instant);
  const paths = contracts.layout.knowledge_graph;
  const substituteProject = (template: string) => substitutePath(template, { project: profile.project.id, sequence: "{sequence}", slug: "{slug}" });
  const componentRecords = components.map((component) => ({
    id: component.stable_id,
    kind: "component",
    name: component.name,
    project: `project:${profile.project.id}`,
    source_paths: [component.path],
    ...(component.mount_path === undefined
      ? {}
      : { mount_path: component.mount_path }),
    relations: [{ type: "part_of", target: `system:${profile.project.id}/${profile.project.kind}` }],
  }));
  const ownedPaths = [
    ...components.map(({ path: componentPath }) => componentPath),
    `ui/content/projects/${profile.project.id}`,
  ].toSorted(compareStrings);
  const otelRuntime = profile.opentelemetry.runtime;
  const transport = otelRuntime ? contracts.opentelemetry.transport.runtime_defaults[otelRuntime] : undefined;
  if (otelRuntime && !transport) throw new Error(`OpenTelemetry runtime '${otelRuntime}' has no current transport default`);

  return {
    schema_version: RESOLVED_BLUEPRINT_SCHEMA_VERSION,
    profile_schema_version: profile.schema_version,
    effective_at: instant,
    project: {
      id: profile.project.id,
      stable_id: `project:${profile.project.id}`,
      name: profile.project.name,
      kind: profile.project.kind,
    },
    components,
    repository_paths: {
      copier_answers: `.copier/projects/${profile.project.id}.yml`,
      project_index: substituteProject(paths.project_index),
      architecture_decisions: substituteProject(paths.architecture_decisions),
      product_decisions: substituteProject(paths.product_decisions),
    },
    selections,
    catalog: {
      system: {
        id: `system:${profile.project.id}/${profile.project.kind}`,
        kind: "system",
        name: profile.project.name,
        project: `project:${profile.project.id}`,
        source_paths: components
          .map(({ path: componentPath }) => componentPath)
          .toSorted(compareStrings),
      },
      components: componentRecords,
    },
    ownership: {
      owned_paths: ownedPaths,
      structural_edits: [
        ".mise.toml#monorepo.config_roots",
        "pnpm-workspace.yaml#packages",
        "ui/content/projects/personal-engineering-platform/platform.yaml#catalog.records",
        "ui/content/projects/personal-engineering-platform/repository-layout.yaml#projects",
      ],
    },
    nix: profile.nix.boundary === "none" ? { enabled: false } : {
      enabled: true,
      boundary: profile.nix.boundary,
      flake_path: profile.nix.flake_path,
      supported_systems: [...contracts.nix.supported_systems].toSorted(compareStrings),
      locked_inputs: contracts.nix.inputs.locked,
      allow_unlocked_production_builds: contracts.nix.inputs.allow_unlocked_production_builds,
      packages: [...profile.nix.packages].toSorted(compareStrings),
      apps: [...profile.nix.apps].toSorted(compareStrings),
      outputs: contracts.nix.outputs,
      mise_tasks: contracts.nix.mise_tasks,
    },
    opentelemetry: profile.opentelemetry.enabled ? {
      enabled: true,
      runtime: otelRuntime,
      resource_attributes: Object.fromEntries(
        contracts.opentelemetry.resource_identity.required.map((attribute) => [
          attribute,
          attribute === "me.robbiepalmer.project.id" ? `project:${profile.project.id}` : "template-required",
        ]),
      ),
      signals: contracts.opentelemetry.signals.required,
      transport,
      semantic_conventions: contracts.opentelemetry.semantic_conventions.policy,
      data_policy: contracts.opentelemetry.data_policy,
      cardinality: contracts.opentelemetry.cardinality,
      failure_mode: contracts.opentelemetry.processing.failure_mode,
    } : { enabled: false },
    manual_checkpoints: checkpoints,
  };
}

export function serializeResolvedBlueprint(blueprint: ResolvedProjectBlueprint): string {
  return `${JSON.stringify(blueprint, null, 2)}\n`;
}
