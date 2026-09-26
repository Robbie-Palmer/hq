import { z } from "zod";

import { ComplexityReferenceSchema } from "./complexity";
import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  CapabilityLevelSchema,
  findDuplicates,
  IdentifierSchema,
  MoneySchema,
  ResourceQuantitySchema,
} from "./vocabulary";

export const DeclaredCapabilitySchema = z
  .object({
    capability: IdentifierSchema,
    level: CapabilityLevelSchema,
  })
  .strict();

export const ObservedCapabilitySchema = z
  .object({
    capability: IdentifierSchema,
    level: CapabilityLevelSchema,
    assessmentId: IdentifierSchema,
    assessedAt: z.iso.datetime(),
  })
  .strict();

export const ResourceAvailabilitySchema = ResourceQuantitySchema.extend({
  observedAt: z.iso.datetime(),
  resetsAt: z.iso.datetime().optional(),
}).strict();

export const RoutingPreferencesSchema = z
  .object({
    workClasses: z.array(IdentifierSchema),
    tags: z.array(IdentifierSchema),
  })
  .strict()
  .superRefine((preferences, context) => {
    for (const [field, values] of [
      ["workClasses", preferences.workClasses],
      ["tags", preferences.tags],
    ] as const) {
      const duplicates = findDuplicates(values);
      if (duplicates.length === 0) continue;
      context.addIssue({
        code: "custom",
        message: `${field} contains duplicate values: ${duplicates.join(", ")}`,
        path: [field],
      });
    }
  });

export const ActorCostSchema = z
  .object({
    funding: z.enum(["unpaid", "prepaid", "metered"]),
    estimatedSessionCost: MoneySchema,
  })
  .strict()
  .refine(
    ({ estimatedSessionCost, funding }) =>
      funding !== "unpaid" || estimatedSessionCost.amount === 0,
    {
      message: "unpaid work must have zero estimated session cost",
      path: ["estimatedSessionCost", "amount"],
    },
  );

const ActorProfileShapeSchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("actor-profile"),
    actorId: IdentifierSchema,
    actorKind: z.enum([
      "person",
      "user-directed-agent",
      "project-directed-agent",
    ]),
    complexityLimits: z.array(ComplexityReferenceSchema),
    routingPreferences: RoutingPreferencesSchema,
    tools: z.array(IdentifierSchema),
    grantedAuthority: z.array(IdentifierSchema),
    access: z.array(IdentifierSchema),
    declaredCapabilities: z.array(DeclaredCapabilitySchema),
    observedCapabilities: z.array(ObservedCapabilitySchema),
    cost: ActorCostSchema,
    resourceAvailability: z.array(ResourceAvailabilitySchema),
  })
  .strict();

export const ActorProfileSchema = ActorProfileShapeSchema.superRefine(
  (actor, context) => {
    const duplicateGroups: Array<[string, string[]]> = [
      ["tools", findDuplicates(actor.tools)],
      ["grantedAuthority", findDuplicates(actor.grantedAuthority)],
      ["access", findDuplicates(actor.access)],
      [
        "declaredCapabilities",
        findDuplicates(
          actor.declaredCapabilities.map(({ capability }) => capability),
        ),
      ],
      [
        "observedCapabilities",
        findDuplicates(
          actor.observedCapabilities.map(({ capability }) => capability),
        ),
      ],
      [
        "complexityLimits",
        findDuplicates(
          actor.complexityLimits.map(
            ({ scaleId, scaleRevision }) => `${scaleId}:${scaleRevision}`,
          ),
        ),
      ],
      [
        "resourceAvailability",
        findDuplicates(
          actor.resourceAvailability.map(({ resource }) => resource),
        ),
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
  },
);
export type ActorProfile = z.infer<typeof ActorProfileSchema>;
