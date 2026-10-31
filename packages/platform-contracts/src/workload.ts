import { z } from "zod";
import {
  deploymentCapabilityIds,
  type DeploymentMaturityContract,
} from "./deployment-maturity";
import { parseContract } from "./parse";
import { platformSlugSchema } from "./platform-manifest";

export const workloadShapeIds = [
  "background-worker",
  "event-consumer",
  "request-driven-service",
  "scheduled-job",
  "stateful-service",
  "static-site",
] as const;

export const workloadCapabilityIds = [
  "immutable-artifact",
  "container-processes",
  "serverless-handlers",
  "scheduled-jobs",
  "ports",
  "http-health-checks",
  "resource-bounds",
  "configuration",
  "secret-references",
  "dependencies",
  "http-ingress",
  "horizontal-scaling",
  "persistence",
  "ordered-migrations",
  "otlp-telemetry",
  "environment-overlays",
] as const;

const environmentVariableSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const quantitySchema = z.string().min(1);
const capabilityModeSchema = z.enum(["preferred", "required"]);
const workloadCapabilitySchema = z.enum(workloadCapabilityIds);
const deploymentCapabilitySchema = z.enum(deploymentCapabilityIds);

const signedArtifactSchema = z
  .object({
    kind: z.enum(["cloudflare-worker-bundle", "oci-image"]),
    repository: z.string().min(1),
    digest: digestSchema,
    signature: z
      .object({
        kind: z.literal("sigstore-bundle"),
        signer: z.string().min(1),
        bundle_ref: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const releaseSchema = z
  .object({
    id: platformSlugSchema,
    artifact: signedArtifactSchema,
  })
  .strict();

const projectIdentitySchema = z
  .object({
    id: platformSlugSchema,
    catalog_id: z.string().min(1),
    owner: platformSlugSchema,
  })
  .strict();

const portSchema = z
  .object({
    name: platformSlugSchema,
    container_port: z.number().int().positive().max(65_535),
    protocol: z.enum(["http", "https", "tcp"]),
  })
  .strict();

const httpProbeSchema = z
  .object({
    path: z.string().startsWith("/"),
    port: platformSlugSchema,
  })
  .strict();

const resourcesSchema = z
  .object({
    requests: z
      .object({ cpu: quantitySchema, memory: quantitySchema })
      .strict(),
    limits: z
      .object({ cpu: quantitySchema, memory: quantitySchema })
      .strict(),
  })
  .strict();

const configurationValueSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("literal"), value: z.string() })
    .strict(),
  z
    .object({
      kind: z.literal("dependency-output"),
      dependency: platformSlugSchema,
      output: platformSlugSchema,
    })
    .strict(),
]);

const secretReferenceSchema = z
  .object({
    dependency: platformSlugSchema,
    output: platformSlugSchema,
    environment_variable: environmentVariableSchema,
  })
  .strict();

const dependencySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("service"),
      type: platformSlugSchema,
      version: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("data"),
      type: z.enum(["object-store", "postgres", "sqlite"]),
      version: z.string().min(1),
      logical_id: z.string().min(1),
    })
    .strict(),
]);

const containerProcessSchema = z
  .object({
    id: platformSlugSchema,
    kind: z.enum(["service", "worker", "job"]),
    artifact_ref: z.literal("release"),
    command: z.array(z.string().min(1)).min(1),
    schedule: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((process, context) => {
    if ((process.kind === "job") !== (process.schedule !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message:
          process.kind === "job"
            ? "is required for a job"
            : "is only valid for a job",
      });
    }
  });

const cloudflareWorkerProcessSchema = z
  .object({
    id: platformSlugSchema,
    kind: z.literal("serverless-handler"),
    artifact_ref: z.literal("release"),
    entrypoint: z.string().min(1),
    handlers: z
      .object({
        fetch: z.boolean().default(false),
        queues: z.array(platformSlugSchema).default([]),
        schedules: z.array(z.string().min(1)).default([]),
      })
      .strict(),
  })
  .strict()
  .superRefine((process, context) => {
    if (
      !process.handlers.fetch &&
      process.handlers.queues.length === 0 &&
      process.handlers.schedules.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["handlers"],
        message: "must enable at least one fetch, queue, or scheduled handler",
      });
    }
  });

const processSchema = z.union([
  containerProcessSchema,
  cloudflareWorkerProcessSchema,
]);

const persistenceSchema = z
  .object({
    id: platformSlugSchema,
    mount_path: z.string().startsWith("/"),
    capacity: quantitySchema,
    access: z.enum(["read-only", "read-write"]),
  })
  .strict();

const migrationSchema = z
  .object({
    id: platformSlugSchema,
    artifact_ref: z.literal("release"),
    command: z.array(z.string().min(1)).min(1),
    dependency: platformSlugSchema,
    order: z.number().int().positive(),
  })
  .strict();

const scalingSchema = z
  .object({
    min_instances: z.number().int().nonnegative(),
    max_instances: z.number().int().positive(),
  })
  .strict()
  .refine(
    ({ min_instances, max_instances }) => min_instances <= max_instances,
    { message: "min_instances must not exceed max_instances" },
  );

const telemetrySchema = z
  .object({
    contract_version: z.number().int().positive(),
    service_namespace: platformSlugSchema,
    service_name: platformSlugSchema,
    transport: z.literal("otlp-http-protobuf"),
  })
  .strict();

const overlaySchema = z
  .object({
    environment: platformSlugSchema,
    configuration: z
      .record(environmentVariableSchema, configurationValueSchema)
      .default({}),
    resources: resourcesSchema.optional(),
    scaling: scalingSchema.optional(),
  })
  .strict();

const targetBase = {
  contract: z.literal("deployment-target"),
  contract_version: z.literal(1),
  id: platformSlugSchema,
  environment: platformSlugSchema,
  required_capabilities: z.array(deploymentCapabilitySchema).min(1),
};

const dockerComposeTargetSchema = z
  .object({
    ...targetBase,
    kind: z.literal("docker-compose"),
    stage: z.literal("local"),
    extensions: z
      .object({
        project_name: platformSlugSchema,
      })
      .strict(),
  })
  .strict();

const cloudflareWorkerTargetSchema = z
  .object({
    ...targetBase,
    kind: z.literal("cloudflare-worker"),
    stage: z.literal("serverless"),
    extensions: z
      .object({
        compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        routes: z.array(z.string().min(1)).min(1),
      })
      .strict(),
  })
  .strict();

const nixosTargetSchema = z
  .object({
    ...targetBase,
    kind: z.literal("nixos-systemd-oci"),
    stage: z.literal("nixos-host"),
    extensions: z
      .object({
        unit_name: platformSlugSchema,
        host: platformSlugSchema,
      })
      .strict(),
  })
  .strict();

const kubernetesTargetSchema = z
  .object({
    ...targetBase,
    kind: z.literal("kubernetes"),
    stage: z.enum(["single-node-k3s", "multi-node-k3s", "kubernetes"]),
    extensions: z
      .object({
        namespace: platformSlugSchema,
        overlays: z
          .array(
            z
              .object({
                kind: z.literal("kustomize"),
                path: z.string().min(1),
              })
              .strict(),
          )
          .default([]),
        packaging: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("none") }).strict(),
          z
            .object({
              kind: z.literal("helm-application"),
              chart: platformSlugSchema,
              release: platformSlugSchema,
            })
            .strict(),
        ]),
      })
      .strict(),
  })
  .strict();

export const deploymentTargetSchema = z.discriminatedUnion("kind", [
  cloudflareWorkerTargetSchema,
  dockerComposeTargetSchema,
  kubernetesTargetSchema,
  nixosTargetSchema,
]);

const workloadFieldsSchema = z
  .object({
    id: platformSlugSchema,
    shape: z.enum(workloadShapeIds),
    runtime_family: z.enum(["cloudflare-worker", "container"]),
    processes: z.array(processSchema).min(1),
    ports: z.array(portSchema).default([]),
    health: z
      .object({
        liveness: httpProbeSchema,
        readiness: httpProbeSchema,
      })
      .strict()
      .optional(),
    resources: resourcesSchema.optional(),
    configuration: z
      .record(environmentVariableSchema, configurationValueSchema)
      .default({}),
    secrets: z.array(secretReferenceSchema).default([]),
    dependencies: z.record(platformSlugSchema, dependencySchema).default({}),
    ingress: z
      .object({
        port: platformSlugSchema.optional(),
        path: z.string().startsWith("/"),
        public_urls: z.array(z.url()).min(1),
      })
      .strict()
      .optional(),
    scaling: scalingSchema,
    persistence: z.array(persistenceSchema).default([]),
    migrations: z.array(migrationSchema).default([]),
    telemetry: telemetrySchema,
    capability_requirements: z
      .array(
        z
          .object({
            capability: workloadCapabilitySchema,
            mode: capabilityModeSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const adapterFeatureSupport: Record<
  z.infer<typeof deploymentTargetSchema>["kind"],
  ReadonlySet<z.infer<typeof workloadCapabilitySchema>>
> = {
  "cloudflare-worker": new Set([
    "immutable-artifact",
    "serverless-handlers",
    "scheduled-jobs",
    "configuration",
    "secret-references",
    "dependencies",
    "http-ingress",
    "horizontal-scaling",
    "otlp-telemetry",
    "environment-overlays",
  ]),
  "docker-compose": new Set([
    "immutable-artifact",
    "container-processes",
    "scheduled-jobs",
    "ports",
    "configuration",
    "secret-references",
    "dependencies",
    "http-ingress",
    "persistence",
    "ordered-migrations",
    "otlp-telemetry",
    "environment-overlays",
  ]),
  kubernetes: new Set(workloadCapabilityIds),
  "nixos-systemd-oci": new Set([
    "immutable-artifact",
    "container-processes",
    "scheduled-jobs",
    "ports",
    "http-health-checks",
    "resource-bounds",
    "configuration",
    "secret-references",
    "dependencies",
    "http-ingress",
    "persistence",
    "ordered-migrations",
    "otlp-telemetry",
    "environment-overlays",
  ]),
};

type WorkloadFields = z.infer<typeof workloadFieldsSchema>;
type DeploymentTarget = z.infer<typeof deploymentTargetSchema>;

function addDuplicateIssue(
  values: readonly string[],
  label: string,
  path: PropertyKey[],
  context: z.RefinementCtx,
): void {
  const duplicate = values.find(
    (value, index) => values.indexOf(value) !== index,
  );
  if (duplicate) {
    context.addIssue({
      code: "custom",
      path,
      message: `duplicate ${label} '${duplicate}'`,
    });
  }
}

function validateUniqueWorkloadValues(
  workload: WorkloadFields,
  context: z.RefinementCtx,
): void {
  addDuplicateIssue(
    workload.processes.map(({ id }) => id),
    "process id",
    ["workload", "processes"],
    context,
  );
  addDuplicateIssue(
    workload.ports.map(({ name }) => name),
    "port name",
    ["workload", "ports"],
    context,
  );
  addDuplicateIssue(
    workload.secrets.map(({ environment_variable }) => environment_variable),
    "secret environment variable",
    ["workload", "secrets"],
    context,
  );
  addDuplicateIssue(
    workload.persistence.map(({ id }) => id),
    "persistence id",
    ["workload", "persistence"],
    context,
  );
  addDuplicateIssue(
    workload.migrations.map(({ id }) => id),
    "migration id",
    ["workload", "migrations"],
    context,
  );
  addDuplicateIssue(
    workload.capability_requirements.map(({ capability }) => capability),
    "workload capability",
    ["workload", "capability_requirements"],
    context,
  );
}

function validateWorkloadNetworkReferences(
  workload: WorkloadFields,
  context: z.RefinementCtx,
): void {
  const portNames = new Set(workload.ports.map(({ name }) => name));
  if (
    workload.health &&
    (!portNames.has(workload.health.liveness.port) ||
      !portNames.has(workload.health.readiness.port))
  ) {
    context.addIssue({
      code: "custom",
      path: ["workload", "health"],
      message: "health checks must reference declared ports",
    });
  }
  if (workload.ingress?.port && !portNames.has(workload.ingress.port)) {
    context.addIssue({
      code: "custom",
      path: ["workload", "ingress", "port"],
      message: "ingress must reference a declared port",
    });
  }
  if (
    workload.runtime_family === "container" &&
    workload.ingress &&
    !workload.ingress.port
  ) {
    context.addIssue({
      code: "custom",
      path: ["workload", "ingress", "port"],
      message: "container ingress must reference a declared port",
    });
  }
  if (
    workload.runtime_family === "cloudflare-worker" &&
    workload.ingress?.port
  ) {
    context.addIssue({
      code: "custom",
      path: ["workload", "ingress", "port"],
      message: "Cloudflare Worker ingress does not declare a container port",
    });
  }
}

function validateWorkloadDependencyReferences(
  workload: WorkloadFields,
  context: z.RefinementCtx,
): void {
  const dependencies = new Set(Object.keys(workload.dependencies));
  const dependencyReferences = [
    ...Object.values(workload.configuration).flatMap((value) =>
      value.kind === "dependency-output" ? [value.dependency] : [],
    ),
    ...workload.secrets.map(({ dependency }) => dependency),
    ...workload.migrations.map(({ dependency }) => dependency),
  ];
  for (const dependency of dependencyReferences) {
    if (!dependencies.has(dependency)) {
      context.addIssue({
        code: "custom",
        path: ["workload", "dependencies"],
        message: `reference to undeclared dependency '${dependency}'`,
      });
    }
  }
}

function validateWorkloadProcesses(
  workload: WorkloadFields,
  context: z.RefinementCtx,
): void {
  const containerProcesses = workload.processes.filter(
    ({ kind }) => kind !== "serverless-handler",
  );
  const serverlessProcesses = workload.processes.filter(
    ({ kind }) => kind === "serverless-handler",
  );
  if (
    workload.runtime_family === "container" &&
    (containerProcesses.length === 0 || serverlessProcesses.length > 0)
  ) {
    context.addIssue({
      code: "custom",
      path: ["workload", "processes"],
      message: "container workloads require only container processes",
    });
  }
  if (
    workload.runtime_family === "cloudflare-worker" &&
    (serverlessProcesses.length !== 1 || containerProcesses.length > 0)
  ) {
    context.addIssue({
      code: "custom",
      path: ["workload", "processes"],
      message: "Cloudflare Worker workloads require one serverless handler",
    });
  }
}

function validateWorkloadFields(
  workload: WorkloadFields,
  context: z.RefinementCtx,
): void {
  validateUniqueWorkloadValues(workload, context);
  validateWorkloadNetworkReferences(workload, context);
  validateWorkloadDependencyReferences(workload, context);
  validateWorkloadProcesses(workload, context);
}

function targetRuntimeMatches(
  target: DeploymentTarget,
  workload: WorkloadFields,
): boolean {
  return target.kind === "cloudflare-worker"
    ? workload.runtime_family === "cloudflare-worker"
    : workload.runtime_family === "container";
}

export interface CompatibilityFinding {
  readonly targetId: string;
  readonly capability: string;
  readonly mode: "preferred" | "required";
  readonly message: string;
}

function adapterCompatibilityFindings(
  workload: WorkloadFields,
  target: DeploymentTarget,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  if (!targetRuntimeMatches(target, workload)) {
    findings.push({
      targetId: target.id,
      capability: "runtime-family",
      mode: "required",
      message: `${target.kind} cannot run '${workload.runtime_family}' workloads`,
    });
  }
  const support = adapterFeatureSupport[target.kind];
  for (const requirement of workload.capability_requirements) {
    if (!support.has(requirement.capability)) {
      findings.push({
        targetId: target.id,
        capability: requirement.capability,
        mode: requirement.mode,
        message: `${target.kind} does not preserve '${requirement.capability}'`,
      });
    }
  }
  return findings;
}

function validateTargets(
  workload: WorkloadFields,
  targets: readonly DeploymentTarget[],
  context: z.RefinementCtx,
): void {
  addDuplicateIssue(
    targets.map(({ id }) => id),
    "deployment target id",
    ["deployment_targets"],
    context,
  );
  targets.forEach((target, targetIndex) => {
    addDuplicateIssue(
      target.required_capabilities,
      "deployment capability",
      ["deployment_targets", targetIndex, "required_capabilities"],
      context,
    );
    for (const finding of adapterCompatibilityFindings(workload, target)) {
      if (finding.mode === "required") {
        context.addIssue({
          code: "custom",
          path: ["deployment_targets", targetIndex],
          message: finding.message,
        });
      }
    }
  });
}

export const workloadDefinitionSchema = z
  .object({
    contract: z.literal("workload-definition"),
    contract_version: z.literal(1),
    project: projectIdentitySchema,
    release: releaseSchema,
    workload: workloadFieldsSchema,
    environment_overlays: z.array(overlaySchema).default([]),
    deployment_targets: z.array(deploymentTargetSchema).min(1),
  })
  .strict()
  .superRefine((definition, context) => {
    validateWorkloadFields(definition.workload, context);
    addDuplicateIssue(
      definition.environment_overlays.map(({ environment }) => environment),
      "environment overlay",
      ["environment_overlays"],
      context,
    );
    if (
      (definition.workload.runtime_family === "container") !==
      (definition.release.artifact.kind === "oci-image")
    ) {
      context.addIssue({
        code: "custom",
        path: ["release", "artifact", "kind"],
        message:
          definition.workload.runtime_family === "container"
            ? "container workloads require an OCI image"
            : "Cloudflare Worker workloads require a worker bundle",
      });
    }
    validateTargets(definition.workload, definition.deployment_targets, context);
  });

export type WorkloadDefinition = z.infer<typeof workloadDefinitionSchema>;
export type WorkloadDeploymentTarget = z.infer<
  typeof deploymentTargetSchema
>;

function maturityAdapterFamily(target: DeploymentTarget): string {
  if (target.kind === "kubernetes") {
    return target.stage.includes("k3s") ? "k3s" : "kubernetes";
  }
  if (target.kind === "nixos-systemd-oci") return "nixos";
  return "serverless";
}

function maturityTargetFindings(
  definition: WorkloadDefinition,
  target: Exclude<DeploymentTarget, { stage: "local" }>,
  maturity: DeploymentMaturityContract,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  const stage = maturity.stages.find(({ id }) => id === target.stage);
  if (!stage) {
    return [
      {
        targetId: target.id,
        capability: "deployment-stage",
        mode: "required",
        message: `deployment stage '${target.stage}' is not in the maturity contract`,
      },
    ];
  }
  if (!stage.supported_workload_shapes.includes(definition.workload.shape)) {
    findings.push({
      targetId: target.id,
      capability: "workload-shape",
      mode: "required",
      message: `stage '${target.stage}' does not support '${definition.workload.shape}'`,
    });
  }
  for (const capability of target.required_capabilities) {
    if (stage.capabilities[capability].mode === "unsupported") {
      findings.push({
        targetId: target.id,
        capability,
        mode: "required",
        message: `stage '${target.stage}' marks '${capability}' unsupported`,
      });
    }
  }
  if (maturityAdapterFamily(target) !== stage.adapter.family) {
    findings.push({
      targetId: target.id,
      capability: "adapter-family",
      mode: "required",
      message: `stage '${target.stage}' requires adapter family '${stage.adapter.family}'`,
    });
  }
  return findings;
}

function maturityCompatibilityFindings(
  definition: WorkloadDefinition,
  maturity: DeploymentMaturityContract,
): CompatibilityFinding[] {
  return definition.deployment_targets.flatMap((target) =>
    target.stage === "local"
      ? []
      : maturityTargetFindings(definition, target, maturity),
  );
}

export function workloadCompatibilityFindings(
  definition: WorkloadDefinition,
  maturity?: DeploymentMaturityContract,
): CompatibilityFinding[] {
  return [
    ...definition.deployment_targets.flatMap((target) =>
      adapterCompatibilityFindings(definition.workload, target),
    ),
    ...(maturity ? maturityCompatibilityFindings(definition, maturity) : []),
  ];
}

function assertCompatible(
  definition: WorkloadDefinition,
  maturity?: DeploymentMaturityContract,
): void {
  const failures = workloadCompatibilityFindings(definition, maturity).filter(
    ({ mode }) => mode === "required",
  );
  if (failures.length > 0) {
    const details = failures
      .map(({ targetId, message }) => `${targetId}: ${message}`)
      .join("; ");
    throw new Error(
      `Unsupported workload deployment: ${details}`,
    );
  }
}

export function parseWorkloadDefinition(
  value: unknown,
  maturity?: DeploymentMaturityContract,
): WorkloadDefinition {
  const definition = parseContract(
    value,
    workloadDefinitionSchema,
    "workload definition",
  );
  assertCompatible(definition, maturity);
  return definition;
}

function targetById(
  definition: WorkloadDefinition,
  targetId: string,
): WorkloadDeploymentTarget {
  const target = definition.deployment_targets.find(
    ({ id }) => id === targetId,
  );
  if (!target) throw new Error(`Unknown deployment target '${targetId}'`);
  return target;
}

function workloadForEnvironment(
  definition: WorkloadDefinition,
  environment: string,
): WorkloadDefinition["workload"] {
  const overlay = definition.environment_overlays.find(
    (candidate) => candidate.environment === environment,
  );
  if (!overlay) return definition.workload;
  return {
    ...definition.workload,
    configuration: {
      ...definition.workload.configuration,
      ...overlay.configuration,
    },
    resources: overlay.resources ?? definition.workload.resources,
    scaling: overlay.scaling ?? definition.workload.scaling,
  };
}

function artifactReference(definition: WorkloadDefinition): string {
  const artifact = definition.release.artifact;
  return `${artifact.repository}@${artifact.digest}`;
}

function invariantSnapshot(
  definition: WorkloadDefinition,
): Record<string, unknown> {
  return {
    project: definition.project,
    workload: {
      id: definition.workload.id,
      shape: definition.workload.shape,
      runtime_family: definition.workload.runtime_family,
      ports: definition.workload.ports,
      health: definition.workload.health,
      dependencies: Object.keys(definition.workload.dependencies).toSorted(
        (left, right) => left.localeCompare(right),
      ),
    },
    release: definition.release,
    observability: {
      service_namespace: definition.workload.telemetry.service_namespace,
      service_name: definition.workload.telemetry.service_name,
      telemetry_contract_version:
        definition.workload.telemetry.contract_version,
    },
  };
}

function configurationVariables(
  workload: WorkloadDefinition["workload"],
): Record<string, string> {
  const values = Object.entries(workload.configuration).map(([name, value]) => [
    name,
    value.kind === "literal"
      ? value.value
      : `\${resources.${value.dependency}.${value.output}}`,
  ]);
  const secrets = workload.secrets.map((secret) => [
    secret.environment_variable,
    `\${resources.${secret.dependency}.${secret.output}}`,
  ]);
  return Object.fromEntries([...values, ...secrets]);
}

export interface ScoreWorkload {
  readonly apiVersion: "score.dev/v1b1";
  readonly metadata: {
    readonly name: string;
    readonly annotations: Readonly<Record<string, string>>;
  };
  readonly containers: Readonly<Record<string, Record<string, unknown>>>;
  readonly service?: { readonly ports: Readonly<Record<string, unknown>> };
  readonly resources: Readonly<Record<string, Record<string, unknown>>>;
}

export function compileScoreWorkload(
  definition: WorkloadDefinition,
  targetId: string,
  maturity?: DeploymentMaturityContract,
): ScoreWorkload {
  assertCompatible(definition, maturity);
  const target = targetById(definition, targetId);
  if (target.kind !== "docker-compose" && target.kind !== "kubernetes") {
    throw new Error(`${target.kind} does not use the Score adapter`);
  }
  const workload = workloadForEnvironment(definition, target.environment);
  if (workload.runtime_family !== "container") {
    throw new Error("Score compilation requires a container workload");
  }
  const image = artifactReference(definition);
  const variables = configurationVariables(workload);
  const containers: Record<string, Record<string, unknown>> = Object.fromEntries(
    workload.processes.map((process) => {
      if (process.kind === "serverless-handler") {
        throw new Error("Score compilation cannot include serverless handlers");
      }
      return [
        process.id,
        {
          image,
          command: process.command,
          variables,
          ...(process.kind === "job"
            ? { extensions: { "platform.schedule": process.schedule } }
            : {}),
          ...(workload.resources ? { resources: workload.resources } : {}),
          ...(workload.health && process.kind === "service"
            ? {
                livenessProbe: {
                  httpGet: {
                    path: workload.health.liveness.path,
                    port: workload.ports.find(
                      ({ name }) => name === workload.health?.liveness.port,
                    )?.container_port,
                  },
                },
                readinessProbe: {
                  httpGet: {
                    path: workload.health.readiness.path,
                    port: workload.ports.find(
                      ({ name }) => name === workload.health?.readiness.port,
                    )?.container_port,
                  },
                },
              }
            : {}),
        },
      ];
    }),
  );
  for (const migration of workload.migrations.toSorted(
    (left, right) => left.order - right.order,
  )) {
    containers[`migration-${migration.id}`] = {
      image,
      command: migration.command,
      variables,
      before: Object.fromEntries(
        workload.processes
          .filter(({ kind }) => kind === "service")
          .map(({ id }) => [id, { ready: "complete" }]),
      ),
    };
  }
  const resources = Object.fromEntries([
    ...Object.entries(workload.dependencies).map(([id, dependency]) => [
      id,
      { type: `${dependency.kind}:${dependency.type}` },
    ]),
    ...workload.persistence.map((volume) => [
      volume.id,
      {
        type: "volume",
        params: {
          capacity: volume.capacity,
          access: volume.access,
          mount_path: volume.mount_path,
        },
      },
    ]),
  ]);
  return {
    apiVersion: "score.dev/v1b1",
    metadata: {
      name: workload.id,
      annotations: {
        "platform.robbiepalmer.me/project-id": definition.project.id,
        "platform.robbiepalmer.me/catalog-id": definition.project.catalog_id,
        "platform.robbiepalmer.me/release-id": definition.release.id,
        "platform.robbiepalmer.me/artifact-digest":
          definition.release.artifact.digest,
      },
    },
    containers,
    ...(workload.ports.length > 0
      ? {
          service: {
            ports: Object.fromEntries(
              workload.ports.map((port) => [
                port.name,
                {
                  port: port.container_port,
                  targetPort: port.container_port,
                  protocol: port.protocol,
                },
              ]),
            ),
          },
        }
      : {}),
    resources,
  };
}

export interface CompiledDeploymentTarget {
  readonly contract: "compiled-deployment-target";
  readonly contract_version: 1;
  readonly target_id: string;
  readonly adapter: string;
  readonly invariants: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
  readonly output: Readonly<Record<string, unknown>>;
}

function compatibilityWarnings(
  definition: WorkloadDefinition,
  target: WorkloadDeploymentTarget,
): string[] {
  return adapterCompatibilityFindings(definition.workload, target)
    .filter(({ mode }) => mode === "preferred")
    .map(({ message }) => message);
}

function compileComposeTarget(
  definition: WorkloadDefinition,
  target: z.infer<typeof dockerComposeTargetSchema>,
  maturity?: DeploymentMaturityContract,
): CompiledDeploymentTarget {
  const score = compileScoreWorkload(definition, target.id, maturity);
  const workload = workloadForEnvironment(definition, target.environment);
  const processById = new Map(
    workload.processes.map((process) => [process.id, process]),
  );
  const volumeMounts = workload.persistence.map((volume) =>
    `${volume.id}:${volume.mount_path}${volume.access === "read-only" ? ":ro" : ""}`,
  );
  const services = Object.fromEntries(
    Object.entries(score.containers).map(([id, container]) => {
      const process = processById.get(id);
      return [
        id,
        {
          image: container.image,
          command: container.command,
          environment: container.variables,
          ...(volumeMounts.length > 0 ? { volumes: volumeMounts } : {}),
          ...(process?.kind === "job"
            ? { "x-platform-schedule": process.schedule }
            : {}),
        },
      ];
    }),
  );
  return {
    contract: "compiled-deployment-target",
    contract_version: 1,
    target_id: target.id,
    adapter: "score-compose",
    invariants: invariantSnapshot(definition),
    warnings: compatibilityWarnings(definition, target),
    output: {
      score,
      compose: {
        name: target.extensions.project_name,
        services,
        volumes: Object.fromEntries(
          workload.persistence.map(({ id }) => [id, {}]),
        ),
      },
      provisioner_state: "external",
    },
  };
}

function kubernetesLabels(
  definition: WorkloadDefinition,
): Record<string, string> {
  return {
    "app.kubernetes.io/name": definition.workload.id,
    "app.kubernetes.io/part-of": definition.project.id,
    "app.kubernetes.io/version": definition.release.id,
  };
}

function kubernetesEnvironment(
  workload: WorkloadDefinition["workload"],
): Array<{ name: string; value: string }> {
  return Object.entries(configurationVariables(workload)).map(
    ([name, value]) => ({ name, value }),
  );
}

function kubernetesVolumes(
  workload: WorkloadDefinition["workload"],
): {
  mounts: Array<{ name: string; mountPath: string; readOnly: boolean }>;
  volumes: Array<{ name: string; persistentVolumeClaim: { claimName: string } }>;
} {
  return {
    mounts: workload.persistence.map((volume) => ({
      name: volume.id,
      mountPath: volume.mount_path,
      readOnly: volume.access === "read-only",
    })),
    volumes: workload.persistence.map((volume) => ({
      name: volume.id,
      persistentVolumeClaim: { claimName: volume.id },
    })),
  };
}

function kubernetesPersistenceResources(
  workload: WorkloadDefinition["workload"],
  namespace: string,
  labels: Readonly<Record<string, string>>,
): Record<string, unknown>[] {
  return workload.persistence.map((volume) => ({
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: volume.id, namespace, labels },
    spec: {
      accessModes: [
        volume.access === "read-only" ? "ReadOnlyMany" : "ReadWriteOnce",
      ],
      resources: { requests: { storage: volume.capacity } },
    },
  }));
}

function kubernetesMigrationResources(
  definition: WorkloadDefinition,
  workload: WorkloadDefinition["workload"],
  namespace: string,
  labels: Readonly<Record<string, string>>,
): Record<string, unknown>[] {
  const volumes = kubernetesVolumes(workload);
  return workload.migrations
    .toSorted((left, right) => left.order - right.order)
    .map((migration) => ({
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: `${workload.id}-migration-${migration.id}`,
        namespace,
        labels,
        annotations: {
          "platform.robbiepalmer.me/execution-order": String(migration.order),
        },
      },
      spec: {
        template: {
          metadata: { labels },
          spec: {
            restartPolicy: "Never",
            volumes: volumes.volumes,
            containers: [
              {
                name: migration.id,
                image: artifactReference(definition),
                command: migration.command,
                env: kubernetesEnvironment(workload),
                volumeMounts: volumes.mounts,
              },
            ],
          },
        },
      },
    }));
}

function kubernetesDeploymentResources(
  definition: WorkloadDefinition,
  workload: WorkloadDefinition["workload"],
  namespace: string,
  labels: Readonly<Record<string, string>>,
  score: ScoreWorkload,
): Record<string, unknown>[] {
  const volumes = kubernetesVolumes(workload);
  return workload.processes.flatMap((process) => {
    if (process.kind === "job" || process.kind === "serverless-handler") {
      return [];
    }
    const container = score.containers[process.id];
    if (!container) {
      throw new Error(`Score output lacks process '${process.id}'`);
    }
    const processLabels = {
      ...labels,
      "app.kubernetes.io/component": process.id,
    };
    const name =
      process.kind === "service"
        ? workload.id
        : `${workload.id}-${process.id}`;
    return [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name, namespace, labels: processLabels },
        spec: {
          replicas: workload.scaling.min_instances,
          selector: { matchLabels: processLabels },
          template: {
            metadata: { labels: processLabels },
            spec: {
              volumes: volumes.volumes,
              containers: [
                {
                  name: process.id,
                  image: artifactReference(definition),
                  command: process.command,
                  env: kubernetesEnvironment(workload),
                  ports: workload.ports.map((port) => ({
                    name: port.name,
                    containerPort: port.container_port,
                  })),
                  resources: workload.resources,
                  volumeMounts: volumes.mounts,
                  livenessProbe: container.livenessProbe,
                  readinessProbe: container.readinessProbe,
                },
              ],
            },
          },
        },
      },
    ];
  });
}

function kubernetesScheduledJobResources(
  definition: WorkloadDefinition,
  workload: WorkloadDefinition["workload"],
  namespace: string,
  labels: Readonly<Record<string, string>>,
): Record<string, unknown>[] {
  const volumes = kubernetesVolumes(workload);
  return workload.processes.flatMap((process) =>
    process.kind === "job"
      ? [
          {
            apiVersion: "batch/v1",
            kind: "CronJob",
            metadata: {
              name: `${workload.id}-${process.id}`,
              namespace,
              labels,
            },
            spec: {
              schedule: process.schedule,
              jobTemplate: {
                spec: {
                  template: {
                    metadata: { labels },
                    spec: {
                      restartPolicy: "Never",
                      volumes: volumes.volumes,
                      containers: [
                        {
                          name: process.id,
                          image: artifactReference(definition),
                          command: process.command,
                          env: kubernetesEnvironment(workload),
                          resources: workload.resources,
                          volumeMounts: volumes.mounts,
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        ]
      : [],
  );
}

function kubernetesNetworkResources(
  workload: WorkloadDefinition["workload"],
  namespace: string,
  labels: Readonly<Record<string, string>>,
): Record<string, unknown>[] {
  if (workload.ports.length === 0) return [];
  const resources: Record<string, unknown>[] = [
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: workload.id, namespace, labels },
      spec: {
        selector: {
          ...labels,
          "app.kubernetes.io/component":
            workload.processes.find(({ kind }) => kind === "service")?.id,
        },
        ports: workload.ports.map((port) => ({
          name: port.name,
          port: port.container_port,
          targetPort: port.container_port,
        })),
      },
    },
  ];
  if (!workload.ingress) return resources;
  resources.push({
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: { name: workload.id, namespace, labels },
    spec: {
      hostnames: workload.ingress.public_urls.map(
        (url) => new URL(url).hostname,
      ),
      rules: [
        {
          matches: [
            {
              path: { type: "PathPrefix", value: workload.ingress.path },
            },
          ],
          backendRefs: [
            {
              name: workload.id,
              port: workload.ports.find(
                ({ name }) => name === workload.ingress?.port,
              )?.container_port,
            },
          ],
        },
      ],
    },
  });
  return resources;
}

function compileKubernetesTarget(
  definition: WorkloadDefinition,
  target: z.infer<typeof kubernetesTargetSchema>,
  maturity?: DeploymentMaturityContract,
): CompiledDeploymentTarget {
  const score = compileScoreWorkload(definition, target.id, maturity);
  const workload = workloadForEnvironment(definition, target.environment);
  const labels = kubernetesLabels(definition);
  const namespace = target.extensions.namespace;
  const migrations = kubernetesMigrationResources(
    definition,
    workload,
    namespace,
    labels,
  );
  const resources = [
    ...kubernetesPersistenceResources(workload, namespace, labels),
    ...migrations,
    ...kubernetesDeploymentResources(
      definition,
      workload,
      namespace,
      labels,
      score,
    ),
    ...kubernetesScheduledJobResources(
      definition,
      workload,
      namespace,
      labels,
    ),
    ...kubernetesNetworkResources(workload, namespace, labels),
  ];
  return {
    contract: "compiled-deployment-target",
    contract_version: 1,
    target_id: target.id,
    adapter: target.stage.includes("k3s") ? "score-k3s" : "score-kubernetes",
    invariants: invariantSnapshot(definition),
    warnings: compatibilityWarnings(definition, target),
    output: {
      score,
      resources,
      apply_order: [
        ...migrations.map((resource) =>
          String((resource.metadata as { name: string }).name),
        ),
        "workload-resources",
      ],
      post_render: target.extensions.overlays,
      packaging: target.extensions.packaging,
      provisioner_state: "external",
    },
  };
}

function compileCloudflareTarget(
  definition: WorkloadDefinition,
  target: z.infer<typeof cloudflareWorkerTargetSchema>,
): CompiledDeploymentTarget {
  const workload = workloadForEnvironment(definition, target.environment);
  const process = workload.processes[0];
  if (process?.kind !== "serverless-handler") {
    throw new Error("Cloudflare targets require a serverless handler");
  }
  return {
    contract: "compiled-deployment-target",
    contract_version: 1,
    target_id: target.id,
    adapter: "cloudflare-worker",
    invariants: invariantSnapshot(definition),
    warnings: compatibilityWarnings(definition, target),
    output: {
      artifact: {
        reference: artifactReference(definition),
        signature: definition.release.artifact.signature,
      },
      wrangler: {
        name: workload.id,
        main: process.entrypoint,
        compatibility_date: target.extensions.compatibility_date,
        routes: target.extensions.routes,
        triggers: process.handlers,
        vars: Object.fromEntries(
          Object.entries(workload.configuration).flatMap(([name, value]) =>
            value.kind === "literal" ? [[name, value.value]] : [],
          ),
        ),
        observability: {
          service_namespace: workload.telemetry.service_namespace,
          service_name: workload.telemetry.service_name,
        },
      },
      bindings: {
        dependencies: workload.dependencies,
        secrets: workload.secrets,
      },
      provisioner_state: "external",
    },
  };
}

function compileNixosTarget(
  definition: WorkloadDefinition,
  target: z.infer<typeof nixosTargetSchema>,
): CompiledDeploymentTarget {
  const workload = workloadForEnvironment(definition, target.environment);
  const process = workload.processes.find(({ kind }) => kind === "service");
  if (!process || process.kind === "serverless-handler") {
    throw new Error("NixOS targets require a service process");
  }
  return {
    contract: "compiled-deployment-target",
    contract_version: 1,
    target_id: target.id,
    adapter: "nixos-systemd-oci",
    invariants: invariantSnapshot(definition),
    warnings: compatibilityWarnings(definition, target),
    output: {
      host: target.extensions.host,
      unit: {
        name: target.extensions.unit_name,
        image: artifactReference(definition),
        command: process.command,
        environment: configurationVariables(workload),
        ports: workload.ports,
        health: workload.health,
        resources: workload.resources,
        persistence: workload.persistence,
      },
      timers: workload.processes.flatMap((candidate) =>
        candidate.kind === "job"
          ? [
              {
                name: candidate.id,
                schedule: candidate.schedule,
                image: artifactReference(definition),
                command: candidate.command,
              },
            ]
          : [],
      ),
      migrations: workload.migrations.toSorted(
        (left, right) => left.order - right.order,
      ),
      provisioner_state: "external",
    },
  };
}

export function compileDeploymentTarget(
  definition: WorkloadDefinition,
  targetId: string,
  maturity?: DeploymentMaturityContract,
): CompiledDeploymentTarget {
  assertCompatible(definition, maturity);
  const target = targetById(definition, targetId);
  if (target.kind === "docker-compose") {
    return compileComposeTarget(definition, target, maturity);
  }
  if (target.kind === "kubernetes") {
    return compileKubernetesTarget(definition, target, maturity);
  }
  if (target.kind === "cloudflare-worker") {
    return compileCloudflareTarget(definition, target);
  }
  return compileNixosTarget(definition, target);
}

function tableRow(values: readonly string[]): string {
  return `| ${values.join(" | ")} |`;
}

export function renderWorkloadDocumentation(
  examples: readonly WorkloadDefinition[],
): string {
  const exampleRows = examples.flatMap((example) =>
    example.deployment_targets.map((target) =>
      tableRow([
        example.project.id,
        example.workload.id,
        example.workload.runtime_family,
        target.id,
        target.kind,
        target.stage,
      ]),
    ),
  );
  return [
    "# Workload definition contract",
    "",
    "Generated from the version 1 schema and checked fixtures. Edit the source contract or fixtures, then regenerate this file.",
    "",
    "## Contract boundary",
    "",
    "The source records project and workload identity, one signed immutable release artifact, runtime intent, dependencies,",
    "telemetry, environment overlays, and explicit deployment targets. Adapters may choose provider resource names and bindings.",
    "They may not rewrite the source identity or artifact digest.",
    "",
    "Provisioner state stays outside the contract and generated output. Compilation is deterministic for the same source and",
    "maturity contract.",
    "",
    "## Portable workload capabilities",
    "",
    ...workloadCapabilityIds.map((capability) => `- \`${capability}\``),
    "",
    "A required capability that an adapter cannot preserve fails validation. A preferred capability produces a compiler warning.",
    "",
    "## Deployment capability vocabulary",
    "",
    ...deploymentCapabilityIds.map((capability) => `- \`${capability}\``),
    "",
    "Targets use the same capability names as the deployment maturity contract. Non-local targets must select a stage that",
    "supports the workload shape and every required deployment capability.",
    "",
    "## Target adapters",
    "",
    "| Target kind | Source runtime | Output |",
    "| --- | --- | --- |",
    tableRow(["cloudflare-worker", "cloudflare-worker", "signed bundle, Wrangler inputs, binding references"]),
    tableRow(["docker-compose", "container", "Score v1b1 and Compose services"]),
    tableRow(["kubernetes", "container", "Score v1b1, ordinary resources, then Kustomize or optional Helm packaging"]),
    tableRow(["nixos-systemd-oci", "container", "signed OCI reference and systemd unit inputs"]),
    "",
    "## Checked examples",
    "",
    "| Project | Workload | Runtime | Target | Adapter | Stage |",
    "| --- | --- | --- | --- | --- | --- |",
    ...exampleRows,
    "",
  ].join("\n");
}
