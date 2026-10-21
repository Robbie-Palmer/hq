import {
  isUtcInstant,
  UTC_INSTANT_PATTERN,
} from "ts-base/dates";
import {
  LOWERCASE_KEBAB_CASE_PATTERN,
  normalizeSlug,
} from "ts-base/strings";
import { z } from "zod";
import { parseContract } from "./parse";

const SLOT_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ADR_REF_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*:\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const platformSlugSchema = z
  .string()
  .regex(LOWERCASE_KEBAB_CASE_PATTERN);
export const platformSlotSchema = z.string().regex(SLOT_PATTERN);
export const platformAdrRefSchema = z.string().regex(ADR_REF_PATTERN);
export const platformUtcInstantSchema = z
  .string()
  .regex(UTC_INSTANT_PATTERN)
  .refine(isUtcInstant, "must be a valid RFC 3339 UTC instant");
export const platformTechnologySlugSchema = z
  .string()
  .min(1)
  .transform(normalizeSlug)
  .pipe(platformSlugSchema);

const prerequisiteSchema = z.union([
  z
    .object({
      slot: platformSlotSchema,
      technology: platformTechnologySlugSchema.optional(),
    })
    .strict(),
  z.object({ requirement: platformSlugSchema }).strict(),
]);

export const platformLayerSourceSchema = z.looseObject({
  slug: platformSlugSchema,
  activated_by: z
    .object({
      slot: platformSlotSchema,
      technology: platformTechnologySlugSchema,
    })
    .strict()
    .optional(),
});

export const platformSlotSourceSchema = z.looseObject({
  slug: platformSlotSchema,
  kind: z.enum(["technology", "policy"]).default("technology"),
  cardinality: z.enum(["one", "many"]).default("one"),
  opinionated: z.boolean().default(true),
  effective_from: platformUtcInstantSchema.optional(),
  effective_until: platformUtcInstantSchema.optional(),
  no_default_from: platformUtcInstantSchema.optional(),
});

export const platformPolicySourceSchema = z.looseObject({
  id: platformSlugSchema,
  layer: platformSlugSchema,
  slot: platformSlotSchema,
  mode: z.enum(["required", "preferred"]),
  decision: platformAdrRefSchema,
  effective_from: platformUtcInstantSchema,
  effective_until: platformUtcInstantSchema.optional(),
  prerequisites: z.array(prerequisiteSchema).default([]),
});

const namedRequirementSchema = z.looseObject({ name: z.string().min(1) });

export const platformSelectionSourceSchema = z
  .looseObject({
    id: platformSlugSchema,
    slot: platformSlotSchema,
    kind: z.enum(["technology", "policy"]).optional(),
    technology: platformTechnologySlugSchema.optional(),
    value: z.string().min(1).optional(),
    status: z.enum(["Proposed", "Accepted", "Rejected", "Deprecated"]),
    decision: platformAdrRefSchema,
    effective_from: platformUtcInstantSchema,
    effective_until: platformUtcInstantSchema.optional(),
    configuration_requirements: z.array(namedRequirementSchema).default([]),
    state_requirements: z.array(namedRequirementSchema).default([]),
    operational_checks: z
      .array(
        z.looseObject({
          name: z.string().min(1),
          reference: z.string().min(1),
        }),
      )
      .default([]),
    manual_setup: z.array(z.string().min(1)).default([]),
  })
  .transform((selection) => ({
    ...selection,
    kind:
      selection.kind ??
      (selection.value !== undefined && selection.technology === undefined
        ? ("policy" as const)
        : ("technology" as const)),
  }))
  .superRefine((selection, context) => {
    if (selection.technology !== undefined && selection.value !== undefined) {
      context.addIssue({
        code: "custom",
        message: "selection cannot define both technology and value",
      });
      return;
    }
    const requiredField = selection.kind === "technology" ? "technology" : "value";
    if (selection[requiredField] === undefined) {
      context.addIssue({
        code: "custom",
        message: `selection kind '${selection.kind}' requires ${requiredField}`,
        path: [requiredField],
      });
    }
  });

export const platformManifestSourceSchema = z
  .object({
    schema_version: z.literal(1),
    project: z.string().min(1),
    catalog: z.unknown().optional(),
    layers: z.array(platformLayerSourceSchema),
    slots: z.array(platformSlotSourceSchema),
    policies: z.array(platformPolicySourceSchema),
    selections: z.array(platformSelectionSourceSchema),
  })
  .strict();

export type PlatformManifestSource = z.infer<
  typeof platformManifestSourceSchema
>;
export type PlatformPolicySource = z.infer<typeof platformPolicySourceSchema>;
export type PlatformSelectionSource = z.infer<
  typeof platformSelectionSourceSchema
>;

export function parsePlatformManifestSource(
  value: unknown,
): PlatformManifestSource {
  return parseContract(value, platformManifestSourceSchema, "platform manifest");
}
