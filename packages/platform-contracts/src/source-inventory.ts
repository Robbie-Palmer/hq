import { z } from "zod";
import { parseContract } from "./parse";

const repositoryPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.includes("\\") &&
      value
        .split("/")
        .every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "must be a normalized repository-relative path",
  );

const projectIdSchema = z.string().regex(/^project:[a-z0-9]+(?:-[a-z0-9]+)*$/);
const componentIdSchema = z
  .string()
  .regex(
    /^component:[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  );
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const profileCoverageSchema = z
  .object({
    path: repositoryPathSchema,
    component_id: slugSchema,
  })
  .strict();

const receiptCoverageSchema = z
  .object({ path: repositoryPathSchema })
  .strict();

const adoptionSchema = z
  .object({
    state: z.enum(["managed", "planned", "deferred"]),
    batch: slugSchema.nullable(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "planned" && value.batch === null) {
      context.addIssue({
        code: "custom",
        message: "planned adoption requires a batch",
        path: ["batch"],
      });
    }
    if (value.state !== "planned" && value.batch !== null) {
      context.addIssue({
        code: "custom",
        message: `${value.state} adoption cannot declare a batch`,
        path: ["batch"],
      });
    }
    if (value.state === "deferred" && value.reason === undefined) {
      context.addIssue({
        code: "custom",
        message: "deferred adoption requires a reason",
        path: ["reason"],
      });
    }
  });

export const sourceInventoryComponentSchema = z
  .object({
    id: componentIdSchema,
    project: projectIdSchema,
    paths: z.array(repositoryPathSchema).min(1),
    toolchains: z.array(slugSchema).min(1),
    profile: profileCoverageSchema.nullable(),
    receipt: receiptCoverageSchema.nullable(),
    adoption: adoptionSchema,
  })
  .strict();

export const sourceInventoryExclusionSchema = z
  .object({
    path: repositoryPathSchema,
    reason: z.string().min(1),
  })
  .strict();

export const sourceInventorySchema = z
  .object({
    schema_version: z.literal(1),
    additional_roots: z.array(repositoryPathSchema),
    components: z.array(sourceInventoryComponentSchema).min(1),
    exclusions: z.array(sourceInventoryExclusionSchema),
  })
  .strict();

export type SourceInventory = z.infer<typeof sourceInventorySchema>;
export type SourceInventoryComponent = z.infer<
  typeof sourceInventoryComponentSchema
>;

export function parseSourceInventory(value: unknown): SourceInventory {
  return parseContract(value, sourceInventorySchema, "source inventory");
}
