import { z } from "zod";

import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  findDuplicates,
  IdentifierSchema,
} from "./vocabulary";

export const ComplexityLevelSchema = z
  .object({
    levelId: IdentifierSchema,
    rank: z.number().int().nonnegative(),
    definition: z.string().trim().min(1).max(500),
  })
  .strict();
export type ComplexityLevel = z.infer<typeof ComplexityLevelSchema>;

export const ComplexityScaleSchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("complexity-scale"),
    scaleId: IdentifierSchema,
    revision: z.number().int().positive(),
    levels: z.array(ComplexityLevelSchema).min(1),
  })
  .strict()
  .superRefine((scale, context) => {
    for (const [field, duplicates] of [
      ["levels.levelId", findDuplicates(scale.levels.map(({ levelId }) => levelId))],
      [
        "levels.rank",
        findDuplicates(scale.levels.map(({ rank }) => rank.toString())),
      ],
    ] as const) {
      if (duplicates.length === 0) continue;
      context.addIssue({
        code: "custom",
        message: `${field} contains duplicate values: ${duplicates.join(", ")}`,
        path: field.split("."),
      });
    }
  });
export type ComplexityScale = z.infer<typeof ComplexityScaleSchema>;

export const ComplexityReferenceSchema = z
  .object({
    scaleId: IdentifierSchema,
    scaleRevision: z.number().int().positive(),
    levelId: IdentifierSchema,
  })
  .strict();
export type ComplexityReference = z.infer<typeof ComplexityReferenceSchema>;
