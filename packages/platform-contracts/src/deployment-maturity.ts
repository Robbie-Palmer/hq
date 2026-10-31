import { z } from "zod";
import { parseContract } from "./parse";
import {
  platformAdrRefSchema,
  platformSlugSchema,
} from "./platform-manifest";

export const deploymentStageIds = [
  "serverless",
  "managed-application",
  "nixos-host",
  "single-node-k3s",
  "multi-node-k3s",
  "kubernetes",
] as const;

export const deploymentCapabilityIds = [
  "identity",
  "secrets",
  "networking",
  "storage",
  "databases",
  "telemetry",
  "backup",
  "deployment",
  "rollback",
  "incident_access",
] as const;

const deploymentStageIdSchema = z.enum(deploymentStageIds);
const ownerSchema = z.enum(["project", "platform", "provider", "shared"]);
const fieldPathSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
const evidenceKindSchema = z.enum([
  "contract-check",
  "cost-record",
  "provider-documentation",
  "recovery-exercise",
  "runbook",
  "runtime-test",
]);

const gateSchema = z
  .object({
    id: platformSlugSchema,
    requirement: z.string().min(1),
    evidence: evidenceKindSchema,
  })
  .strict();

const capabilitySchema = z
  .object({
    mode: z.enum(["required", "delegated", "unsupported"]),
    owner: ownerSchema,
    requirement: z.string().min(1),
  })
  .strict();

const capabilitiesSchema = z.object(
  Object.fromEntries(
    deploymentCapabilityIds.map((capability) => [capability, capabilitySchema]),
  ) as Record<(typeof deploymentCapabilityIds)[number], typeof capabilitySchema>,
).strict();

const availabilityProofSchema = z
  .object({
    kind: z.enum([
      "capacity-test",
      "failover-test",
      "provider-sla",
      "recovery-test",
    ]),
    reference: z.string().min(1),
  })
  .strict();

const recoverySchema = z
  .object({
    availability_claim: z.enum([
      "not-claimed",
      "single-instance",
      "provider-sla",
      "high-availability",
    ]),
    failure_domains: z.array(platformSlugSchema).min(1),
    recovery_time_assumption: z.string().min(1),
    data_loss_assumption: z.string().min(1),
    proof: z.array(availabilityProofSchema).default([]),
  })
  .strict()
  .superRefine((recovery, context) => {
    if (
      recovery.availability_claim === "single-instance" &&
      recovery.failure_domains.length !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["failure_domains"],
        message: "single-instance recovery must name exactly one failure domain",
      });
    }

    if (
      recovery.availability_claim === "provider-sla" &&
      !recovery.proof.some(({ kind }) => kind === "provider-sla")
    ) {
      context.addIssue({
        code: "custom",
        path: ["proof"],
        message: "provider-sla claims require provider SLA evidence",
      });
    }

    if (recovery.availability_claim !== "high-availability") return;

    const proofKinds = new Set(recovery.proof.map(({ kind }) => kind));
    const missing = ["capacity-test", "failover-test", "recovery-test"].filter(
      (kind) => !proofKinds.has(kind as z.infer<typeof availabilityProofSchema>["kind"]),
    );
    if (recovery.failure_domains.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["failure_domains"],
        message: "high-availability claims require at least two failure domains",
      });
    }
    if (missing.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["proof"],
        message: `high-availability claims lack ${missing.join(", ")} evidence`,
      });
    }
  });

const stageSchema = z
  .object({
    id: deploymentStageIdSchema,
    sequence: z.number().int().positive(),
    name: z.string().min(1),
    supported_workload_shapes: z
      .array(
        z.enum([
          "background-worker",
          "event-consumer",
          "request-driven-service",
          "scheduled-job",
          "stateful-service",
          "static-site",
        ]),
      )
      .min(1),
    ownership: z
      .object({
        application: ownerSchema,
        runtime: ownerSchema,
        control_plane: ownerSchema,
        data: ownerSchema,
        incident_response: ownerSchema,
      })
      .strict(),
    entry_criteria: z.array(gateSchema).min(1),
    exit_triggers: z.array(gateSchema).min(1),
    cost: z
      .object({
        model: z.enum(["consumption", "subscription", "host", "cluster"]),
        idle: z.enum(["zero", "variable", "fixed"]),
        assumptions: z.array(z.string().min(1)).min(1),
        review_triggers: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    recovery: recoverySchema,
    capabilities: capabilitiesSchema,
    adapter: z
      .object({
        family: platformSlugSchema,
        changes: z.array(fieldPathSchema).min(1),
      })
      .strict(),
  })
  .strict();

export const deploymentMaturityContractSchema = z
  .object({
    contract: z.literal("deployment-maturity"),
    contract_version: z.literal(1),
    decision: platformAdrRefSchema,
    invariants: z
      .object({
        project_identity: z.array(fieldPathSchema).min(1),
        workload: z.array(fieldPathSchema).min(1),
        release: z.array(fieldPathSchema).min(1),
      })
      .strict(),
    target_variant_fields: z.array(fieldPathSchema).min(1),
    stages: z.array(stageSchema).length(deploymentStageIds.length),
  })
  .strict()
  .superRefine((contract, context) => {
    contract.stages.forEach((stage, index) => {
      const expectedId = deploymentStageIds[index];
      if (stage.id !== expectedId) {
        context.addIssue({
          code: "custom",
          path: ["stages", index, "id"],
          message: `expected stage '${expectedId}' at sequence ${index + 1}`,
        });
      }
      if (stage.sequence !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["stages", index, "sequence"],
          message: `expected sequence ${index + 1}`,
        });
      }
    });

    const invariantFields = new Set(Object.values(contract.invariants).flat());
    for (const [index, field] of contract.target_variant_fields.entries()) {
      if (invariantFields.has(field)) {
        context.addIssue({
          code: "custom",
          path: ["target_variant_fields", index],
          message: `field '${field}' cannot be both invariant and target-owned`,
        });
      }
    }

    const targetFields = new Set(contract.target_variant_fields);
    contract.stages.forEach((stage, stageIndex) => {
      stage.adapter.changes.forEach((field, fieldIndex) => {
        if (!targetFields.has(field)) {
          context.addIssue({
            code: "custom",
            path: ["stages", stageIndex, "adapter", "changes", fieldIndex],
            message: `field '${field}' is not declared as target-owned`,
          });
        }
      });
    });
  });

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const verificationKindSchema = z.enum([
  "data",
  "rollback",
  "route",
  "signature",
  "telemetry",
]);

const promotionProjectSchema = z
  .object({
    id: platformSlugSchema,
    catalog_id: z.string().min(1),
    owner: z.string().min(1),
  })
  .strict();

const promotionWorkloadSchema = z
  .object({
    id: platformSlugSchema,
    runtime_family: z.literal("container"),
    ports: z
      .array(
        z
          .object({
            name: platformSlugSchema,
            port: z.number().int().positive(),
            protocol: z.enum(["http", "https", "tcp"]),
          })
          .strict(),
      )
      .min(1),
    health: z
      .object({
        liveness: z.string().min(1),
        readiness: z.string().min(1),
      })
      .strict(),
    dependencies: z.array(platformSlugSchema),
  })
  .strict();

const promotionInvariantSchema = z
  .object({
    public_urls: z.array(z.url()).min(1),
    data: z
      .object({
        logical_id: z.string().min(1),
        engine: z.string().min(1),
        schema: z.string().min(1),
        backup_evidence: z.string().min(1),
      })
      .strict(),
    observability: z
      .object({
        service_namespace: z.string().min(1),
        service_name: z.string().min(1),
        telemetry_contract_version: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const promotionTargetSchema = z
  .object({
    stage: deploymentStageIdSchema,
    project: promotionProjectSchema,
    workload: promotionWorkloadSchema,
    adapter: z
      .object({
        family: platformSlugSchema,
        kind: platformSlugSchema,
      })
      .strict(),
    artifact_digest: digestSchema,
    signature_verification: z
      .object({
        subject_digest: digestSchema,
        signer: z.string().min(1),
        bundle_ref: z.string().min(1),
        result: z.literal("passed"),
      })
      .strict(),
    public_urls: z.array(z.url()).min(1),
    data: promotionInvariantSchema.shape.data,
    observability: promotionInvariantSchema.shape.observability,
    verification: z
      .array(
        z
          .object({
            kind: verificationKindSchema,
            evidence: z.string().min(1),
            result: z.literal("passed"),
          })
          .strict(),
      )
      .min(1),
    rollback: z
      .object({
        mechanism: z.string().min(1),
        previous_artifact_digest: digestSchema,
        evidence: z.string().min(1),
        result: z.literal("passed"),
      })
      .strict(),
  })
  .strict();

const promotionEvidenceSourceSchema = z
  .object({
    contract: z.literal("deployment-promotion-evidence"),
    contract_version: z.literal(1),
    maturity_contract_version: z.literal(1),
    project: promotionProjectSchema,
    workload: promotionWorkloadSchema,
    release: z
      .object({
        id: platformSlugSchema,
        artifact: z
          .object({
            kind: z.literal("oci-image"),
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
          .strict(),
        previous_artifact_digest: digestSchema,
      })
      .strict(),
    invariants: promotionInvariantSchema,
    targets: z.array(promotionTargetSchema).min(3),
  })
  .strict();

type PromotionEvidenceSource = z.infer<typeof promotionEvidenceSourceSchema>;
type PromotionTarget = z.infer<typeof promotionTargetSchema>;

function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addTargetIssue(
  context: z.RefinementCtx,
  targetIndex: number,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({
    code: "custom",
    path: ["targets", targetIndex, ...path],
    message,
  });
}

function validatePromotionTarget(
  target: PromotionTarget,
  evidence: PromotionEvidenceSource,
  index: number,
  context: z.RefinementCtx,
): void {
  if (!valuesMatch(target.project, evidence.project)) {
    addTargetIssue(context, index, ["project"], "target must preserve project identity");
  }
  if (!valuesMatch(target.workload, evidence.workload)) {
    addTargetIssue(
      context,
      index,
      ["workload"],
      "target must preserve workload identity and intent",
    );
  }
  if (target.artifact_digest !== evidence.release.artifact.digest) {
    addTargetIssue(
      context,
      index,
      ["artifact_digest"],
      "target must use the signed release artifact digest",
    );
  }
  if (
    target.signature_verification.subject_digest !==
      evidence.release.artifact.digest ||
    target.signature_verification.signer !==
      evidence.release.artifact.signature.signer ||
    target.signature_verification.bundle_ref !==
      evidence.release.artifact.signature.bundle_ref
  ) {
    addTargetIssue(
      context,
      index,
      ["signature_verification"],
      "target must verify the release signature identity and bundle",
    );
  }
  if (!valuesMatch(target.public_urls, evidence.invariants.public_urls)) {
    addTargetIssue(
      context,
      index,
      ["public_urls"],
      "target must preserve the public URLs",
    );
  }
  if (!valuesMatch(target.data, evidence.invariants.data)) {
    addTargetIssue(
      context,
      index,
      ["data"],
      "target must preserve the logical data store and schema",
    );
  }
  if (!valuesMatch(target.observability, evidence.invariants.observability)) {
    addTargetIssue(
      context,
      index,
      ["observability"],
      "target must preserve the observability identity",
    );
  }
  if (
    target.rollback.previous_artifact_digest !==
    evidence.release.previous_artifact_digest
  ) {
    addTargetIssue(
      context,
      index,
      ["rollback", "previous_artifact_digest"],
      "rollback must restore the declared previous artifact",
    );
  }

  const verificationKinds = new Set(
    target.verification.map(({ kind }) => kind),
  );
  const missing = verificationKindSchema.options.filter(
    (kind) => !verificationKinds.has(kind),
  );
  if (missing.length > 0) {
    addTargetIssue(
      context,
      index,
      ["verification"],
      `target lacks ${missing.join(", ")} verification evidence`,
    );
  }
}

export const promotionEvidenceSchema = promotionEvidenceSourceSchema.superRefine(
  (evidence, context) => {
    const stageIds = evidence.targets.map(({ stage }) => stage);
    const middleStages = new Set(["managed-application", "nixos-host"]);
    if (!stageIds.includes("serverless")) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "promotion evidence must include a serverless target",
      });
    }
    if (!stageIds.some((stage) => middleStages.has(stage))) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "promotion evidence must include a managed application or NixOS target",
      });
    }
    if (!stageIds.includes("kubernetes")) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "promotion evidence must include a Kubernetes target",
      });
    }

    evidence.targets.forEach((target, index) => {
      validatePromotionTarget(target, evidence, index, context);
    });
  },
);

export type DeploymentMaturityContract = z.infer<
  typeof deploymentMaturityContractSchema
>;
export type DeploymentStage = z.infer<typeof stageSchema>;
export type PromotionEvidence = z.infer<typeof promotionEvidenceSchema>;

export function parseDeploymentMaturityContract(
  value: unknown,
): DeploymentMaturityContract {
  return parseContract(
    value,
    deploymentMaturityContractSchema,
    "deployment maturity contract",
  );
}

export function parsePromotionEvidence(
  value: unknown,
  maturityContract: DeploymentMaturityContract,
): PromotionEvidence {
  const evidence = parseContract(
    value,
    promotionEvidenceSchema,
    "deployment promotion evidence",
  );
  let previousSequence = 0;
  evidence.targets.forEach((target, index) => {
    const stage = maturityContract.stages.find(
      (candidate) => candidate.id === target.stage,
    );
    if (!stage) {
      throw new Error(
        `Invalid deployment promotion evidence: targets.${index}.stage is not in the maturity contract`,
      );
    }
    if (stage.sequence <= previousSequence) {
      throw new Error(
        "Invalid deployment promotion evidence: targets must follow maturity-stage order",
      );
    }
    if (stage.adapter.family !== target.adapter.family) {
      throw new Error(
        `Invalid deployment promotion evidence: targets.${index}.adapter.family must be '${stage.adapter.family}'`,
      );
    }
    previousSequence = stage.sequence;
  });
  return evidence;
}

function wrapText(
  value: string,
  firstPrefix = "",
  continuationPrefix = firstPrefix,
): string {
  const lines: string[] = [];
  let line = firstPrefix;
  for (const word of value.split(/\s+/)) {
    const separator = line === firstPrefix ? "" : " ";
    if (line.length + separator.length + word.length > 120) {
      lines.push(line);
      line = `${continuationPrefix}${word}`;
    } else {
      line += `${separator}${word}`;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

function list(items: readonly string[]): string {
  return items
    .map((item) => wrapText(item, "- ", "  "))
    .join("\n");
}

function tableRow(values: readonly string[]): string {
  return `| ${values.join(" | ")} |`;
}

export function renderDeploymentMaturityDocumentation(
  contract: DeploymentMaturityContract,
  example: PromotionEvidence,
): string {
  const sections = contract.stages.map((stage) => {
    const ownership = Object.entries(stage.ownership)
      .map(([boundary, owner]) => `${boundary.replaceAll("_", " ")}: ${owner}`)
      .join(", ");
    const capabilityRows = deploymentCapabilityIds.map((capability) => {
      const value = stage.capabilities[capability];
      return tableRow([
        capability.replaceAll("_", " "),
        value.mode,
        value.owner,
        value.requirement,
      ]);
    });
    return [
      `## ${stage.sequence}. ${stage.name}`,
      "",
      `Adapter family: \`${stage.adapter.family}\``,
      "",
      wrapText(
        `Supported workload shapes: ${stage.supported_workload_shapes.join(", ")}.`,
      ),
      "",
      wrapText(`Ownership: ${ownership}.`),
      "",
      `### ${stage.name} entry criteria`,
      "",
      list(
        stage.entry_criteria.map(
          (criterion) =>
            `${criterion.requirement} Evidence: ${criterion.evidence}.`,
        ),
      ),
      "",
      `### ${stage.name} exit triggers`,
      "",
      list(
        stage.exit_triggers.map(
          (trigger) => `${trigger.requirement} Evidence: ${trigger.evidence}.`,
        ),
      ),
      "",
      `### ${stage.name} cost and recovery assumptions`,
      "",
      `Cost model: ${stage.cost.model}. Idle cost: ${stage.cost.idle}.`,
      "",
      list(stage.cost.assumptions),
      "",
      `Availability claim: ${stage.recovery.availability_claim}.`,
      "",
      list([
        stage.recovery.recovery_time_assumption,
        stage.recovery.data_loss_assumption,
      ]),
      "",
      `### ${stage.name} required capabilities`,
      "",
      tableRow(["Capability", "Mode", "Owner", "Requirement"]),
      tableRow(["---", "---", "---", "---"]),
      ...capabilityRows,
    ].join("\n");
  });

  const targetRows = example.targets.map((target) =>
    tableRow([
      target.stage,
      target.adapter.kind,
      target.artifact_digest,
      target.rollback.mechanism,
    ]),
  );
  return [
    "# Deployment maturity contract",
    "",
    `Generated from contract version ${contract.contract_version}. The governing decision is \`${contract.decision}\`.`,
    "",
    "## Promotion invariants",
    "",
    "Project identity fields:",
    "",
    list(contract.invariants.project_identity.map((field) => `\`${field}\``)),
    "",
    "Workload fields:",
    "",
    list(contract.invariants.workload.map((field) => `\`${field}\``)),
    "",
    "Release fields:",
    "",
    list(contract.invariants.release.map((field) => `\`${field}\``)),
    "",
    "Target adapters own these fields:",
    "",
    list(contract.target_variant_fields.map((field) => `\`${field}\``)),
    "",
    "## Availability rule",
    "",
    wrapText(
      "A stage may claim high availability only after capacity, failover, and recovery tests cover at least two failure domains. Version 1 makes no high-availability claim.",
    ),
    "",
    sections.join("\n\n"),
    "",
    "## Checked promotion example",
    "",
    wrapText(
      `Project \`${example.project.id}\` promotes release \`${example.release.id}\` for workload \`${example.workload.id}\`. Every target uses the same project and workload identity, signed OCI digest, public URLs, logical data store, data schema, and OpenTelemetry service identity.`,
    ),
    "",
    tableRow(["Stage", "Adapter", "Artifact digest", "Rollback"]),
    tableRow(["---", "---", "---", "---"]),
    ...targetRows,
    "",
  ].join("\n");
}
