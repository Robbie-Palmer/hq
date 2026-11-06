import { parse } from "yaml";
import { z } from "zod";
import {
  type DeliveryEvidenceContract,
  deliveryEvidenceContractSchema,
} from "platform-contracts/delivery-evidence";
import {
  type DeploymentMaturityContract,
  parseDeploymentMaturityContract,
} from "platform-contracts/deployment-maturity";
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
  parseWorkloadDefinition,
  type WorkloadDefinition,
  workloadDefinitionSchema,
} from "platform-contracts/workload";
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

export const PROJECT_PROFILE_SCHEMA_VERSION = 3;
export const RESOLVED_BLUEPRINT_SCHEMA_VERSION = 4;

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
  "project-ui",
  "project-content",
  "worker",
  "typescript-package",
  "python-pipeline",
  "cpp-project",
  "terraform-root",
  "kubernetes-component",
  "homelab-system",
  "homelab-subsystem",
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

const templateOwnershipSchema = z.enum(["structure-only", "project"]);

const runtimeRoleSchema = z.enum([
  "authenticated-worker",
  "api-contracts",
  "relational-data",
]);

const miseCommandSchema = z
  .string()
  .regex(/^mise \/\//, "must invoke a repository task through mise");

const statefulHookCommandSchema = z
  .string()
  .regex(
    /^mise \/\/[a-z0-9./-]*:[a-z0-9][a-z0-9:._-]*$/,
    "must invoke one repository task through mise without inline shell syntax",
  );

const dopplerReferenceSchema = z
  .string()
  .regex(
    /^doppler:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:_[a-z0-9]+)*$/,
    "must be a redacted doppler://project/config reference",
  );

const operationalCheckSchema = z
  .object({
    id: slugSchema,
    command: miseCommandSchema,
  })
  .strict();

const migrationCheckpointSchema = z
  .object({
    id: slugSchema,
    action: z.string().min(1),
    verification: miseCommandSchema,
    status: z.enum(["pending", "verified"]).default("pending"),
    evidence: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (checkpoint.status === "verified" && checkpoint.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "must contain at least one item when a checkpoint is verified",
      });
    }
  });

const statefulPreviewOperationsSchema = z
  .object({
    github_environment: z.string().min(1),
    secret_config_ref: dopplerReferenceSchema,
    provision: statefulHookCommandSchema,
    migrate: statefulHookCommandSchema,
    seed_synthetic: statefulHookCommandSchema,
    deploy: statefulHookCommandSchema,
    smoke_authenticated: statefulHookCommandSchema,
    smoke_telemetry: statefulHookCommandSchema,
    cleanup: statefulHookCommandSchema,
  })
  .strict();

const statefulProductionOperationsSchema = z
  .object({
    github_environment: z.string().min(1),
    plan_secret_config_ref: dopplerReferenceSchema,
    apply_secret_config_ref: dopplerReferenceSchema,
    migrate: statefulHookCommandSchema,
    deploy: statefulHookCommandSchema,
    smoke: statefulHookCommandSchema,
    rollback: statefulHookCommandSchema,
  })
  .strict();

const statefulBackupOperationsSchema = z
  .object({
    github_environment: z.string().min(1),
    secret_config_ref: dopplerReferenceSchema,
    schedule: z
      .string()
      .regex(
        /^(?:[0-5]?\d) (?:[01]?\d|2[0-3]) \* \* [0-6]$/,
        "must be a weekly UTC cron expression",
      ),
    create: statefulHookCommandSchema,
    restore: statefulHookCommandSchema,
  })
  .strict();

const statefulAlertOperationsSchema = z
  .object({
    github_environment: z.string().min(1),
    secret_config_ref: dopplerReferenceSchema,
    responder: z.string().min(1),
    smoke: statefulHookCommandSchema,
  })
  .strict();

const statefulOperationsSchema = z
  .object({
    preview: statefulPreviewOperationsSchema,
    production: statefulProductionOperationsSchema,
    backup: statefulBackupOperationsSchema.optional(),
    alerting: statefulAlertOperationsSchema.optional(),
  })
  .strict()
  .superRefine((operations, context) => {
    const references = [
      operations.preview.secret_config_ref,
      operations.production.plan_secret_config_ref,
      operations.production.apply_secret_config_ref,
      ...(operations.backup ? [operations.backup.secret_config_ref] : []),
      ...(operations.alerting ? [operations.alerting.secret_config_ref] : []),
    ];
    const duplicate = references.find(
      (reference, index) => references.indexOf(reference) !== index,
    );
    if (duplicate) {
      context.addIssue({
        code: "custom",
        path: ["production", "apply_secret_config_ref"],
        message: `secret handoff references must be distinct; duplicate '${duplicate}'`,
      });
    }
  });

const rolloutSchema = z
  .object({
    operational_checks: z.array(operationalCheckSchema).default([]),
    migration_checkpoints: z.array(migrationCheckpointSchema).default([]),
    stateful_operations: statefulOperationsSchema.optional(),
  })
  .strict()
  .superRefine((rollout, context) => {
    addDuplicateIssues(
      rollout.operational_checks.map(({ id }) => id),
      "operational check ids",
      context,
    );
    addDuplicateIssues(
      rollout.migration_checkpoints.map(({ id }) => id),
      "migration checkpoint ids",
      context,
    );
  });

const componentSchema = z
  .object({
    id: slugSchema,
    kind: componentKindSchema,
    name: z.string().min(1),
    mount_path: webMountPathSchema.optional(),
    template_ownership: templateOwnershipSchema.optional(),
    runtime_role: runtimeRoleSchema.optional(),
    task_exceptions: z.array(taskExceptionSchema).default([]),
  })
  .strict()
  .superRefine((component, context) => {
    if (component.kind === "project-ui" && component.mount_path === undefined) {
      context.addIssue({
        code: "custom",
        path: ["mount_path"],
        message: "is required for a project-ui component",
      });
    }
    if (component.kind !== "project-ui" && component.mount_path !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["mount_path"],
        message: "is only valid for a project-ui component",
      });
    }
    if (
      component.runtime_role !== undefined &&
      component.template_ownership !== "structure-only"
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtime_role"],
        message: "requires template_ownership 'structure-only'",
      });
    }
    if (
      component.runtime_role === "authenticated-worker" &&
      component.kind !== "worker"
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtime_role"],
        message: "authenticated-worker requires component kind 'worker'",
      });
    }
    if (
      component.runtime_role !== undefined &&
      component.runtime_role !== "authenticated-worker" &&
      component.kind !== "typescript-package"
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtime_role"],
        message: `${component.runtime_role} requires component kind 'typescript-package'`,
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

const reconciliationPolicySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("tracking"),
      defer: z
        .object({
          effective_at: utcInstantSchema,
          reason: z.string().min(1),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("frozen"),
      frozen_at: utcInstantSchema,
      reason: z.string().min(1),
    })
    .strict(),
]);

const checkpointFulfillmentSchema = z
  .object({
    checkpoint: slugSchema,
    status: z.enum(["pending", "verified"]),
    evidence: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((fulfillment, context) => {
    if (
      fulfillment.status === "verified" &&
      fulfillment.evidence.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "must contain at least one item when a checkpoint is verified",
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

const projectProfileVersion1FieldsSchema = z
  .object({
    schema_version: z.literal(1),
    project: z
      .object({
        id: slugSchema,
        name: z.string().min(1),
        kind: projectKindSchema,
        published: z.boolean().default(true),
      })
      .strict(),
    components: z.array(componentSchema).min(1),
    layers: z.array(layerUseSchema).min(1),
    requirements: z.array(slugSchema).default([]),
    overrides: z.array(overrideSchema).default([]),
    checkpoint_fulfillment: z.array(checkpointFulfillmentSchema).default([]),
    rollout: rolloutSchema.default({
      operational_checks: [],
      migration_checkpoints: [],
    }),
    reconciliation: reconciliationPolicySchema.default({ mode: "tracking" }),
    nix: nixProfileSchema,
    opentelemetry: otelProfileSchema,
    capabilities: unsupportedCapabilitiesSchema.optional(),
  })
  .strict();

const projectProfileVersion2FieldsSchema = projectProfileVersion1FieldsSchema
  .omit({ schema_version: true, capabilities: true })
  .extend({
    schema_version: z.literal(2),
    capabilities: z
      .object({
        workloads: z.array(workloadDefinitionSchema).min(1),
      })
      .strict(),
  })
  .strict();

const projectProfileVersion3FieldsSchema = projectProfileVersion1FieldsSchema
  .omit({ schema_version: true, capabilities: true })
  .extend({
    schema_version: z.literal(PROJECT_PROFILE_SCHEMA_VERSION),
    capabilities: z
      .object({
        workloads: z.array(workloadDefinitionSchema).default([]),
        delivery_evidence: deliveryEvidenceContractSchema,
      })
      .strict(),
  })
  .strict();

type ProjectProfileInput =
  | z.infer<typeof projectProfileVersion1FieldsSchema>
  | z.infer<typeof projectProfileVersion2FieldsSchema>
  | z.infer<typeof projectProfileVersion3FieldsSchema>;

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
    "project UI mount paths",
    context,
  );
  const runtimeRoles = profile.components.flatMap(({ runtime_role }) =>
    runtime_role === undefined ? [] : [runtime_role],
  );
  addDuplicateIssues(runtimeRoles, "runtime roles", context);
  if (
    runtimeRoles.length > 0 &&
    runtimeRoleSchema.options.some((role) => !runtimeRoles.includes(role))
  ) {
    context.addIssue({
      code: "custom",
      path: ["components"],
      message:
        "authenticated runtime generation requires one authenticated-worker, one api-contracts, and one relational-data component",
    });
  }
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
  addDuplicateIssues(
    profile.checkpoint_fulfillment.map(({ checkpoint }) => checkpoint),
    "checkpoint fulfillment records",
    context,
  );

  const compatibleKinds: Record<z.infer<typeof projectKindSchema>, readonly z.infer<typeof componentKindSchema>[]> = {
    application: ["ui", "project-ui", "project-content", "worker"],
    service: ["worker", "python-pipeline"],
    library: ["typescript-package", "cpp-project"],
    "data-pipeline": ["python-pipeline"],
    "embedded-system": ["cpp-project"],
    infrastructure: ["terraform-root", "kubernetes-component", "homelab-system", "homelab-subsystem"],
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

export const projectProfileSchema = z
  .discriminatedUnion("schema_version", [
    projectProfileVersion1FieldsSchema,
    projectProfileVersion2FieldsSchema,
    projectProfileVersion3FieldsSchema,
  ])
  .superRefine(validateProfile);
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
  deployment_maturity: DeploymentMaturityContract;
}

export interface ResolvedSelection {
  readonly id: string;
  readonly layer: string;
  readonly slot: string;
  readonly kind: "technology" | "policy";
  readonly value: string;
  readonly source: "default" | "override";
  readonly decision: string;
}

export interface ResolvedProfilePolicy {
  readonly id: string;
  readonly layer: string;
  readonly slot: string;
  readonly mode: "required" | "preferred";
  readonly decision: string;
}

export interface ResolvedFulfillmentCheckpoint {
  readonly id: string;
  readonly action: string;
  readonly fulfillment: "manual";
  readonly status: "pending" | "verified";
  readonly evidence: readonly string[];
}

export interface ResolvedProjectBlueprint {
  readonly schema_version: 2 | 3 | 4;
  readonly profile_schema_version: 1 | 2 | 3;
  readonly effective_at: string;
  readonly project: {
    readonly id: string;
    readonly stable_id: string;
    readonly name: string;
    readonly kind: string;
    readonly published?: boolean;
  };
  readonly components: readonly {
    readonly id: string;
    readonly stable_id: string;
    readonly name: string;
    readonly kind: string;
    readonly path: string;
    readonly mount_path?: string;
    readonly template_ownership?: "structure-only" | "project";
    readonly runtime_role?: z.infer<typeof runtimeRoleSchema>;
    readonly tasks: readonly {
      readonly name: string;
      readonly disposition:
        | "generated"
        | "inherited"
        | "delegated"
        | "not-applicable";
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
    readonly delivery_targets?: readonly Record<string, unknown>[];
  };
  readonly ownership: {
    readonly owned_paths: readonly string[];
    readonly structural_edits: readonly string[];
  };
  readonly nix: Record<string, unknown>;
  readonly opentelemetry: Record<string, unknown>;
  readonly workloads?: readonly WorkloadDefinition[];
  readonly delivery_evidence?: ResolvedDeliveryEvidence;
  readonly fulfillment_checkpoints: readonly ResolvedFulfillmentCheckpoint[];
  readonly rollout: {
    readonly operational_checks: readonly {
      readonly id: string;
      readonly command: string;
    }[];
    readonly migration_checkpoints: readonly {
      readonly id: string;
      readonly action: string;
      readonly verification: string;
      readonly status: "pending" | "verified";
      readonly evidence: readonly string[];
    }[];
    readonly stateful_operations?: z.infer<typeof statefulOperationsSchema>;
  };
}

export interface ResolvedDeliverySourcePath {
  readonly path: string;
  readonly mode: "exclusive" | "shared";
  readonly subjects: readonly string[];
}

export interface ResolvedDeliveryTarget {
  readonly id: string;
  readonly project_id: string;
  readonly subjects: readonly string[];
  readonly shared_host_id?: string;
  readonly source_paths: readonly ResolvedDeliverySourcePath[];
  readonly github: {
    readonly required_ci_names: readonly string[];
    readonly production_environments: readonly string[];
  };
}

export interface ResolvedDeliveryEvidence {
  readonly contract: "resolved-project-delivery-evidence";
  readonly contract_version: 1;
  readonly repository: string;
  readonly targets: readonly ResolvedDeliveryTarget[];
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
  deploymentMaturity: string;
}): ProjectProfileContracts {
  return {
    layout: parseRepositoryLayoutContract(parse(sources.layout)),
    platform: parsePlatformManifestSource(parse(sources.platform)),
    nix: parseNixFlakeContract(parse(sources.nix)),
    opentelemetry: parseOpenTelemetryContract(parse(sources.opentelemetry)),
    deployment_maturity: parseDeploymentMaturityContract(
      parse(sources.deploymentMaturity),
    ),
  };
}

function resolveProfileWorkloads(
  profile: ProjectProfile,
  contracts: ProjectProfileContracts,
): readonly WorkloadDefinition[] {
  if (profile.schema_version === 1) return [];
  return profile.capabilities.workloads.map((workload) => {
    if (workload.project.id !== profile.project.id) {
      throw new Error(
        `Workload '${workload.workload.id}' project id must match profile project '${profile.project.id}'`,
      );
    }
    if (workload.project.catalog_id !== `project:${profile.project.id}`) {
      throw new Error(
        `Workload '${workload.workload.id}' catalog id must be 'project:${profile.project.id}'`,
      );
    }
    return parseWorkloadDefinition(workload, contracts.deployment_maturity);
  });
}

function platformCatalogRecords(
  contracts: ProjectProfileContracts,
): readonly Record<string, unknown>[] {
  const catalog = contracts.platform.catalog;
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) {
    return [];
  }
  const records = (catalog as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];
  return records.filter(
    (record): record is Record<string, unknown> =>
      record !== null && typeof record === "object" && !Array.isArray(record),
  );
}

function recordSourcePaths(record: Record<string, unknown>): readonly string[] {
  const sourcePaths = record.source_paths;
  if (sourcePaths === undefined) return [];
  if (
    !Array.isArray(sourcePaths) ||
    sourcePaths.some((sourcePath) => typeof sourcePath !== "string")
  ) {
    throw new Error(
      `Catalog record '${String(record.id)}' has invalid source_paths`,
    );
  }
  return sourcePaths as string[];
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function shareSubject(
  left: ResolvedDeliverySourcePath,
  right: ResolvedDeliverySourcePath,
): boolean {
  const rightSubjects = new Set(right.subjects);
  return left.subjects.some((subject) => rightSubjects.has(subject));
}

function assertCompatibleDeliveryPaths(
  left: ResolvedDeliveryTarget,
  right: ResolvedDeliveryTarget,
): void {
  for (const leftPath of left.source_paths) {
    for (const rightPath of right.source_paths) {
      if (!pathsOverlap(leftPath.path, rightPath.path)) continue;
      if (leftPath.mode === "shared" && rightPath.mode === "shared") continue;
      if (shareSubject(leftPath, rightPath)) continue;
      throw new Error(
        `Delivery targets '${left.id}' and '${right.id}' have conflicting source paths '${leftPath.path}' and '${rightPath.path}'`,
      );
    }
  }
}

export function validateResolvedDeliveryEvidenceCatalog(
  contracts: readonly ResolvedDeliveryEvidence[],
): void {
  const targets = contracts.flatMap((contract) =>
    contract.targets.map((target) => ({
      repository: contract.repository,
      target,
    })),
  );
  const duplicateTarget = targets.find(
    (candidate, index) =>
      targets.findIndex(
        ({ repository, target }) =>
          repository === candidate.repository &&
          target.id === candidate.target.id,
      ) !== index,
  );
  if (duplicateTarget) {
    throw new Error(
      `Duplicate delivery target '${duplicateTarget.target.id}' in '${duplicateTarget.repository}'`,
    );
  }

  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    const left = targets[leftIndex];
    if (!left) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < targets.length;
      rightIndex += 1
    ) {
      const right = targets[rightIndex];
      if (left.repository !== right?.repository) continue;
      assertCompatibleDeliveryPaths(left.target, right.target);
    }
  }
}

type DeliveryTargetDeclaration = DeliveryEvidenceContract["targets"][number];
type MutableDeliverySourcePath = {
  mode: "exclusive" | "shared";
  subjects: Set<string>;
};

function addDeliverySourcePath(
  sourcePaths: Map<string, MutableDeliverySourcePath>,
  targetId: string,
  input: {
    path: string;
    mode: "exclusive" | "shared";
    subject?: string;
  },
): void {
  const existing = sourcePaths.get(input.path);
  if (existing && existing.mode !== input.mode) {
    throw new Error(
      `Delivery target '${targetId}' assigns both exclusive and shared ownership to '${input.path}'`,
    );
  }
  const entry = existing ?? {
    mode: input.mode,
    subjects: new Set<string>(),
  };
  if (input.subject) entry.subjects.add(input.subject);
  sourcePaths.set(input.path, entry);
}

function resolveDeliveryTarget(
  target: DeliveryTargetDeclaration,
  projectId: string,
  subjectPaths: ReadonlyMap<string, readonly string[]>,
): ResolvedDeliveryTarget {
  const sourcePaths = new Map<string, MutableDeliverySourcePath>();
  for (const subject of target.subjects) {
    const paths = subjectPaths.get(subject);
    if (paths === undefined) {
      throw new Error(
        `Delivery target '${target.id}' references unknown project subject '${subject}'`,
      );
    }
    for (const sourcePath of paths) {
      addDeliverySourcePath(sourcePaths, target.id, {
        path: sourcePath,
        mode: target.shared_host ? "shared" : "exclusive",
        subject,
      });
    }
  }
  for (const sourcePath of target.source_paths) {
    addDeliverySourcePath(sourcePaths, target.id, sourcePath);
  }
  if (sourcePaths.size === 0) {
    throw new Error(
      `Delivery target '${target.id}' does not resolve any source paths`,
    );
  }

  return {
    id: `delivery-target:${projectId}/${target.id}`,
    project_id: `project:${projectId}`,
    subjects: [...target.subjects].toSorted(compareStrings),
    ...(target.shared_host
      ? { shared_host_id: `shared-host:${target.shared_host}` }
      : {}),
    source_paths: [...sourcePaths.entries()]
      .map(([sourcePath, binding]) => ({
        path: sourcePath,
        mode: binding.mode,
        subjects: [...binding.subjects].toSorted(compareStrings),
      }))
      .toSorted((left, right) => compareStrings(left.path, right.path)),
    github: {
      required_ci_names: [...target.github.required_ci_names].toSorted(
        compareStrings,
      ),
      production_environments: [
        ...target.github.production_environments,
      ].toSorted(compareStrings),
    },
  };
}

function resolveDeliveryEvidence(
  profile: ProjectProfile,
  contracts: ProjectProfileContracts,
  components: ResolvedProjectBlueprint["components"],
  workloads: readonly WorkloadDefinition[],
): ResolvedDeliveryEvidence | undefined {
  if (profile.schema_version !== 3) {
    return undefined;
  }
  const declaration: DeliveryEvidenceContract =
    profile.capabilities.delivery_evidence;
  const projectId = profile.project.id;
  const expectedProject = `project:${projectId}`;
  const subjectPaths = new Map<string, readonly string[]>();
  for (const record of platformCatalogRecords(contracts)) {
    if (record.project !== expectedProject || typeof record.id !== "string") {
      continue;
    }
    if (!/^(?:component|workload):/.test(record.id)) continue;
    subjectPaths.set(record.id, recordSourcePaths(record));
  }
  for (const component of components) {
    subjectPaths.set(component.stable_id, [component.path]);
  }
  for (const workload of workloads) {
    const id = `workload:${projectId}/${workload.workload.id}`;
    if (!subjectPaths.has(id)) subjectPaths.set(id, []);
  }

  const targets = declaration.targets
    .map((target) => resolveDeliveryTarget(target, projectId, subjectPaths))
    .toSorted((left, right) => compareStrings(left.id, right.id));

  const resolved: ResolvedDeliveryEvidence = {
    contract: "resolved-project-delivery-evidence",
    contract_version: 1,
    repository: declaration.repository,
    targets,
  };
  validateResolvedDeliveryEvidenceCatalog([resolved]);
  return resolved;
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

function resolveComponentTask(
  name: z.infer<typeof taskNameSchema>,
  componentKind: RepositoryLayoutContract["component_kinds"][number],
  exceptionReason: string | undefined,
): ResolvedProjectBlueprint["components"][number]["tasks"][number] {
  if (exceptionReason !== undefined) {
    return { name, disposition: "not-applicable", reason: exceptionReason };
  }
  if (componentKind.task_ownership === "inherited") {
    return { name, disposition: "inherited" };
  }
  if (componentKind.task_ownership === "delegated") {
    if (!componentKind.delegated_task_project) {
      throw new Error(
        `Component kind '${componentKind.id}' delegates tasks without a target project`,
      );
    }
    const taskName = name === "typecheck-or-compile" ? "typecheck" : name;
    return {
      name,
      disposition: "delegated",
      target: `${componentKind.delegated_task_project}:${taskName}`,
    };
  }
  return { name, disposition: "generated" };
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
      ...(component.template_ownership === undefined
        ? {}
        : { template_ownership: component.template_ownership }),
      ...(component.runtime_role === undefined
        ? {}
        : { runtime_role: component.runtime_role }),
      tasks: requiredTasks
        .toSorted(compareStrings)
        .map((name) =>
          resolveComponentTask(name, componentKind, exceptions.get(name)),
        ),
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
  readonly checkpoints: Map<string, ResolvedFulfillmentCheckpoint>;
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

export function resolveProjectPolicies(
  profile: ProjectProfile,
  contracts: ProjectProfileContracts,
  effectiveAt: string,
): readonly ResolvedProfilePolicy[] {
  const instant = utcInstantSchema.parse(effectiveAt);
  validateAgainstContracts(profile, contracts);
  return activePolicies(profile, contracts, instant).map(
    ({ id, layer, slot, mode, decision }) => ({
      id,
      layer,
      slot,
      mode,
      decision,
    }),
  );
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

function addCheckpoint(
  checkpoints: Map<string, ResolvedFulfillmentCheckpoint>,
  input: {
    readonly selectionId: string;
    readonly kind: "configuration" | "state" | "operational-check" | "manual-setup";
    readonly label: string;
    readonly action: string;
  },
): void {
  const label = normalizeSlug(
    input.label.replaceAll(/[^a-zA-Z0-9]+/g, " "),
  );
  if (!label) {
    throw new Error(
      `Fulfillment checkpoint for '${input.selectionId}' needs an identifiable label`,
    );
  }
  const id = `${input.selectionId}-${input.kind}-${label}`;
  if (checkpoints.has(id)) {
    throw new Error(`Duplicate fulfillment checkpoint '${id}'`);
  }
  checkpoints.set(id, {
    id,
    action: input.action,
    fulfillment: "manual",
    status: "pending",
    evidence: [],
  });
}

function addSelectionCheckpoints(
  selections: readonly PlatformSelection[],
  checkpoints: Map<string, ResolvedFulfillmentCheckpoint>,
): void {
  for (const selection of selections) {
    for (const requirement of selection.configuration_requirements) {
      addCheckpoint(checkpoints, {
        selectionId: selection.id,
        kind: "configuration",
        label: requirement.name,
        action: `Configure ${requirement.name} for ${selection.id}`,
      });
    }
    for (const requirement of selection.state_requirements) {
      addCheckpoint(checkpoints, {
        selectionId: selection.id,
        kind: "state",
        label: requirement.name,
        action: `Provision ${requirement.name} for ${selection.id}`,
      });
    }
    for (const check of selection.operational_checks) {
      addCheckpoint(checkpoints, {
        selectionId: selection.id,
        kind: "operational-check",
        label: check.name,
        action: `Verify ${check.name}: ${check.reference}`,
      });
    }
    for (const step of selection.manual_setup) {
      addCheckpoint(checkpoints, {
        selectionId: selection.id,
        kind: "manual-setup",
        label: step,
        action: step,
      });
    }
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
): {
  selections: ResolvedSelection[];
  checkpoints: ResolvedFulfillmentCheckpoint[];
} {
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
    checkpoints: new Map(),
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
  const fulfillment = new Map(
    profile.checkpoint_fulfillment.map((record) => [record.checkpoint, record]),
  );
  for (const checkpoint of fulfillment.keys()) {
    if (!state.checkpoints.has(checkpoint)) {
      throw new Error(
        `Checkpoint fulfillment references unknown current checkpoint '${checkpoint}'`,
      );
    }
  }
  const checkpoints = Array.from(state.checkpoints.values())
    .map((checkpoint) => {
      const record = fulfillment.get(checkpoint.id);
      return record === undefined
        ? checkpoint
        : {
            ...checkpoint,
            status: record.status,
            evidence: [...record.evidence].toSorted(compareStrings),
          };
    })
    .toSorted((left, right) => compareStrings(left.id, right.id));
  return {
    selections: state.resolved.toSorted((left, right) => left.slot.localeCompare(right.slot, "en") || left.value.localeCompare(right.value, "en")),
    checkpoints,
  };
}

function resolvedBlueprintSchemaVersion(
  profileSchemaVersion: ProjectProfile["schema_version"],
): ResolvedProjectBlueprint["schema_version"] {
  if (profileSchemaVersion === 1) return 2;
  if (profileSchemaVersion === 2) return 3;
  return RESOLVED_BLUEPRINT_SCHEMA_VERSION;
}

function validateStatefulOperations(
  profile: ProjectProfile,
  components: ResolvedProjectBlueprint["components"],
  selections: readonly ResolvedSelection[],
): void {
  const operations = profile.rollout.stateful_operations;
  if (!operations) return;

  const terraformRoots = components.filter(
    ({ kind }) => kind === "terraform-root",
  );
  if (terraformRoots.length !== 1) {
    throw new Error(
      `Stateful operations require one terraform-root component, found ${terraformRoots.length}`,
    );
  }

  const selectedSlots = new Set(selections.map(({ slot }) => slot));
  const requiredSlots = [
    "backend-api.runtime",
    "database.migration-discipline",
    "database.preview-isolation",
    "database.relational-host",
    "delivery.ci",
    "delivery.preview-environment",
    "infrastructure.provisioner",
    "infrastructure.state-backend",
    "security.preview-access",
  ];
  const missingSlots = requiredSlots.filter((slot) => !selectedSlots.has(slot));
  if (missingSlots.length > 0) {
    throw new Error(
      `Stateful operations require selected capabilities: ${missingSlots.join(", ")}`,
    );
  }

  const backupSelected = selectedSlots.has("database.backup-restore");
  if (backupSelected !== (operations.backup !== undefined)) {
    throw new Error(
      "Stateful backup operations must be declared exactly when database.backup-restore is selected",
    );
  }

  const alertingSelected = selectedSlots.has(
    "observability.alert-evaluation",
  );
  if (alertingSelected !== (operations.alerting !== undefined)) {
    throw new Error(
      "Stateful alert operations must be declared exactly when observability.alert-evaluation is selected",
    );
  }
}

const AUTHENTICATED_WORKER_STACK = new Map<string, string>([
  ["api-governance.compatibility-check", "oasdiff"],
  ["api-governance.contract-linter", "spectral"],
  ["backend-api.contract-format", "openapi"],
  ["backend-api.contract-generator", "honozod-openapi"],
  ["backend-api.http-framework", "hono"],
  ["backend-api.relational-connection", "hyperdrive"],
  ["backend-api.runtime", "cloudflare-workers"],
  ["database.migration-discipline", "Committed ordered migrations with drift checks and one serialized deployment runner"],
  ["database.relational-access", "drizzle"],
  ["database.relational-engine", "postgresql"],
  ["database.relational-host", "neon"],
  ["identity.authentication-library", "better-auth"],
  ["identity.authorization-policy", "Project-owned server-side resource and action policy"],
  ["identity.login-provider", "google-oauth"],
  ["identity.session-transport", "Same-origin Secure HttpOnly first-party cookie session"],
]);

function assertAuthenticatedWorkerStack(
  components: ResolvedProjectBlueprint["components"],
  selections: readonly ResolvedSelection[],
): void {
  if (!components.some(({ runtime_role }) => runtime_role !== undefined)) return;
  const selected = new Map(selections.map(({ slot, value }) => [slot, value]));
  const mismatch = [...AUTHENTICATED_WORKER_STACK].find(
    ([slot, value]) => selected.get(slot) !== value,
  );
  if (!mismatch) return;
  const [slot, value] = mismatch;
  throw new Error(
    `Authenticated runtime generation requires '${slot}' to resolve to '${value}'`,
  );
}

export function resolveProjectProfile(
  profile: ProjectProfile,
  contracts: ProjectProfileContracts,
  effectiveAt: string,
): ResolvedProjectBlueprint {
  const instant = utcInstantSchema.parse(effectiveAt);
  validateAgainstContracts(profile, contracts);
  const components = resolveComponents(profile, contracts);
  const workloads = resolveProfileWorkloads(profile, contracts);
  const deliveryEvidence = resolveDeliveryEvidence(
    profile,
    contracts,
    components,
    workloads,
  );
  const { selections, checkpoints } = resolveSelections(profile, contracts, instant);
  validateStatefulOperations(profile, components, selections);
  assertAuthenticatedWorkerStack(components, selections);
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
  const deliveryTargetRecords =
    deliveryEvidence?.targets.map((target) => ({
      id: target.id,
      kind: "delivery-target",
      project: `project:${profile.project.id}`,
      repository: deliveryEvidence.repository,
      source_paths: target.source_paths.map(({ path: sourcePath }) => sourcePath),
      source_path_bindings: target.source_paths,
      subjects: target.subjects,
      ...(target.shared_host_id
        ? { shared_host_id: target.shared_host_id }
        : {}),
      github: target.github,
      relations: [
        {
          type: "part_of",
          target: `system:${profile.project.id}/${profile.project.kind}`,
        },
      ],
    })) ?? [];
  const ownedPaths = [
    ...new Set([
      ...components.map(({ path: componentPath }) => componentPath),
      ...(profile.project.published
        ? [`ui/content/projects/${profile.project.id}`]
        : []),
    ]),
  ].toSorted(compareStrings);
  const otelRuntime = profile.opentelemetry.runtime;
  const transport = otelRuntime ? contracts.opentelemetry.transport.runtime_defaults[otelRuntime] : undefined;
  if (otelRuntime && !transport) throw new Error(`OpenTelemetry runtime '${otelRuntime}' has no current transport default`);

  return {
    schema_version: resolvedBlueprintSchemaVersion(profile.schema_version),
    profile_schema_version: profile.schema_version,
    effective_at: instant,
    project: {
      id: profile.project.id,
      stable_id: `project:${profile.project.id}`,
      name: profile.project.name,
      kind: profile.project.kind,
      published: profile.project.published,
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
      ...(deliveryTargetRecords.length > 0
        ? { delivery_targets: deliveryTargetRecords }
        : {}),
    },
    ownership: {
      owned_paths: ownedPaths,
      structural_edits: [
        ".mise.toml#monorepo.config_roots",
        "pnpm-workspace.yaml#packages",
        ...(profile.project.published
          ? [
              "ui/content/projects/personal-engineering-platform/platform.yaml#catalog.records",
              "ui/content/projects/personal-engineering-platform/repository-layout.yaml#projects",
            ]
          : []),
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
    ...(workloads.length > 0 ? { workloads } : {}),
    ...(deliveryEvidence ? { delivery_evidence: deliveryEvidence } : {}),
    fulfillment_checkpoints: checkpoints,
    rollout: {
      operational_checks: [...profile.rollout.operational_checks]
        .toSorted((left, right) => compareStrings(left.id, right.id)),
      migration_checkpoints: profile.rollout.migration_checkpoints
        .map((checkpoint) => ({
          ...checkpoint,
          evidence: [...checkpoint.evidence].toSorted(compareStrings),
        }))
        .toSorted((left, right) => compareStrings(left.id, right.id)),
      ...(profile.rollout.stateful_operations
        ? { stateful_operations: profile.rollout.stateful_operations }
        : {}),
    },
  };
}

export function serializeResolvedBlueprint(blueprint: ResolvedProjectBlueprint): string {
  return `${JSON.stringify(blueprint, null, 2)}\n`;
}
