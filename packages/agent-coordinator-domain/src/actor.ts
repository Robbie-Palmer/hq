import { z } from "zod";

import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  CapabilityLevelSchema,
  ComplexitySchema,
  findDuplicates,
  IdentifierSchema,
  MoneySchema,
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
    sampleSize: z.number().int().positive(),
    successRate: z.number().min(0).max(1),
    observedAt: z.iso.datetime(),
  })
  .strict();

export const ActorCapacitySchema = z
  .object({
    maximumSessions: z.number().int().positive(),
    activeSessions: z.number().int().nonnegative(),
    availableUntil: z.iso.datetime().optional(),
  })
  .strict()
  .refine(
    ({ activeSessions, maximumSessions }) => activeSessions <= maximumSessions,
    {
      message: "activeSessions cannot exceed maximumSessions",
      path: ["activeSessions"],
    },
  );

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
    maximumComplexity: ComplexitySchema,
    interests: z.array(IdentifierSchema),
    tools: z.array(IdentifierSchema),
    grantedAuthority: z.array(IdentifierSchema),
    access: z.array(IdentifierSchema),
    declaredCapabilities: z.array(DeclaredCapabilitySchema),
    observedCapabilities: z.array(ObservedCapabilitySchema),
    cost: ActorCostSchema,
    capacity: ActorCapacitySchema,
  })
  .strict();

export const ActorProfileSchema = ActorProfileShapeSchema.superRefine(
  (actor, context) => {
    const duplicateGroups: Array<[string, string[]]> = [
      ["interests", findDuplicates(actor.interests)],
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
