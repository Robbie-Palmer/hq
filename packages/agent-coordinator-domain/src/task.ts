import { z } from "zod";

import { ComplexityReferenceSchema } from "./complexity";
import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  CapabilityLevelSchema,
  EvidenceStageSchema,
  findDuplicates,
  IdentifierSchema,
  MoneySchema,
  ResourceQuantitySchema,
} from "./vocabulary";

export const CapabilityRequirementSchema = z
  .object({
    capability: IdentifierSchema,
    minimumLevel: CapabilityLevelSchema,
    requiresObservedEvidence: z.boolean(),
  })
  .strict();
export type CapabilityRequirement = z.infer<
  typeof CapabilityRequirementSchema
>;

export const EvidenceRequirementSchema = z
  .object({
    kind: IdentifierSchema,
    stage: EvidenceStageSchema,
  })
  .strict();
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

const TaskRequirementsShapeSchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("task-requirements"),
    taskId: IdentifierSchema,
    workClass: IdentifierSchema,
    complexity: ComplexityReferenceSchema,
    tags: z.array(IdentifierSchema),
    requiredCapabilities: z.array(CapabilityRequirementSchema),
    requiredAuthority: z.array(IdentifierSchema),
    requiredAccess: z.array(IdentifierSchema),
    requiredTools: z.array(IdentifierSchema),
    preferredTools: z.array(IdentifierSchema),
    requiredEvidence: z.array(EvidenceRequirementSchema),
    requiredResources: z.array(ResourceQuantitySchema),
    estimatedCost: MoneySchema.optional(),
  })
  .strict();

export const TaskRequirementsSchema = TaskRequirementsShapeSchema.superRefine(
  (task, context) => {
    const duplicateGroups: Array<[string, string[]]> = [
      [
        "requiredCapabilities",
        findDuplicates(
          task.requiredCapabilities.map(({ capability }) => capability),
        ),
      ],
      ["requiredAuthority", findDuplicates(task.requiredAuthority)],
      ["requiredAccess", findDuplicates(task.requiredAccess)],
      ["requiredTools", findDuplicates(task.requiredTools)],
      ["preferredTools", findDuplicates(task.preferredTools)],
      [
        "requiredEvidence",
        findDuplicates(
          task.requiredEvidence.map(({ kind, stage }) => `${kind}:${stage}`),
        ),
      ],
      ["tags", findDuplicates(task.tags)],
      [
        "requiredResources",
        findDuplicates(task.requiredResources.map(({ resource }) => resource)),
      ],
    ];

    for (const [field, duplicates] of duplicateGroups) {
      if (duplicates.length === 0) continue;
      context.addIssue({
        code: "custom",
        message: `${field} contains duplicate values: ${duplicates.join(", ")}`,
        path: [field],
      });
    }

    const requiredTools = new Set(task.requiredTools);
    const repeatedPreferences = task.preferredTools.filter((tool) =>
      requiredTools.has(tool),
    );
    if (repeatedPreferences.length > 0) {
      context.addIssue({
        code: "custom",
        message: "preferredTools cannot repeat requiredTools",
        path: ["preferredTools"],
      });
    }
  },
);
export type TaskRequirements = z.infer<typeof TaskRequirementsSchema>;
