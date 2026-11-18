import { z } from "zod";
import { parseContract } from "./parse";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
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
        .every(
          (segment) =>
            segment !== "" && segment !== "." && segment !== "..",
        ),
    "must be a normalized repository-relative path",
  );

export const repositoryLayoutNamedRecordSchema = z
  .object({
    id: slugSchema,
    description: z.string().optional(),
    task_profile: slugSchema.optional(),
  })
  .strict();

const componentKindFields = {
  directory: repositoryPathSchema,
  mise_config_root: z.boolean().default(true),
  pnpm_workspace_package: z.boolean().default(false),
  task_ownership: z.enum(["generated", "inherited", "delegated"]).optional(),
  delegated_task_project: z
    .string()
    .regex(/^\/\/[a-z0-9][a-z0-9./-]*$/)
    .optional(),
};

function normalizeTaskOwnership<
  T extends {
    task_ownership?: "generated" | "inherited" | "delegated";
    delegated_task_project?: string;
  },
>(component: T): T & { task_ownership: "generated" | "inherited" | "delegated" } {
  return {
    ...component,
    task_ownership:
      component.task_ownership ??
      (component.delegated_task_project ? "delegated" : "generated"),
  };
}

export const repositoryLayoutComponentKindV1Schema =
  repositoryLayoutNamedRecordSchema
    .extend(componentKindFields)
    .strict()
    .transform(normalizeTaskOwnership);

export const repositoryLayoutComponentKindV2Schema =
  repositoryLayoutNamedRecordSchema
    .extend({
      ...componentKindFields,
      technology: slugSchema,
      migration_directories: z.array(repositoryPathSchema).max(1).default([]),
      migration_delegated_task_project: z
        .string()
        .regex(/^\/\/[a-z0-9][a-z0-9./-]*$/)
        .optional(),
      migration_only: z.boolean().default(false),
    })
    .strict()
    .transform(normalizeTaskOwnership);

export const repositoryLayoutProjectRegistrationSchema =
  repositoryLayoutNamedRecordSchema
    .extend({ kind: slugSchema, catalog_record: z.string() })
    .strict();

export const repositoryLayoutSharedManifestSchema = z
  .object({ path: repositoryPathSchema, allowed_edits: z.array(z.string()) })
  .strict();

const taskContractSchema = z
  .object({ id: slugSchema, required: z.array(slugSchema) })
  .strict();

const knowledgeGraphSchema = z
  .object({
    project_index: repositoryPathSchema,
    architecture_decisions: repositoryPathSchema,
    product_decisions: repositoryPathSchema,
  })
  .strict();

const workspacePolicyFields = {
  node_workspace: repositoryPathSchema,
  node_lockfile: repositoryPathSchema,
  standalone_node_roots: z.array(repositoryPathSchema),
  approved_npm_lockfiles: z.array(repositoryPathSchema),
  local_mise_roots: z.array(repositoryPathSchema),
};

const contractFields = {
  project_kinds: z.array(repositoryLayoutNamedRecordSchema),
  projects: z.array(repositoryLayoutProjectRegistrationSchema),
  task_contract: taskContractSchema,
  knowledge_graph: knowledgeGraphSchema,
  shared_manifests: z.array(repositoryLayoutSharedManifestSchema),
};

const repositoryLayoutContractV1Schema = z
  .object({
    schema_version: z.literal(1),
    ...contractFields,
    component_kinds: z.array(repositoryLayoutComponentKindV1Schema),
    workspace_policy: z.object(workspacePolicyFields).strict(),
  })
  .strict();

export const repositoryLayoutTechnologyRootSchema = z
  .object({
    id: slugSchema,
    directory: repositoryPathSchema,
    workspace: z.enum([
      "pnpm",
      "uv",
      "cmake",
      "terraform",
      "nix",
      "kubernetes",
      "ansible",
      "container",
      "content",
    ]),
  })
  .strict();

const repositoryLayoutContractV2Schema = z
  .object({
    schema_version: z.literal(2),
    enforcement: z.enum(["migration", "final"]),
    ...contractFields,
    migration_knowledge_graph: knowledgeGraphSchema.optional(),
    component_kinds: z.array(repositoryLayoutComponentKindV2Schema),
    workspace_policy: z
      .object({
        ...workspacePolicyFields,
        technology_roots: z.array(repositoryLayoutTechnologyRootSchema),
      })
      .strict(),
  })
  .strict();

export const repositoryLayoutContractSchema = z.discriminatedUnion(
  "schema_version",
  [repositoryLayoutContractV1Schema, repositoryLayoutContractV2Schema],
);

export type RepositoryLayoutNamedRecord = z.infer<
  typeof repositoryLayoutNamedRecordSchema
>;
export type RepositoryLayoutComponentKind =
  | z.infer<typeof repositoryLayoutComponentKindV1Schema>
  | z.infer<typeof repositoryLayoutComponentKindV2Schema>;
export type RepositoryLayoutSharedManifest = z.infer<
  typeof repositoryLayoutSharedManifestSchema
>;
export type RepositoryLayoutContract = z.infer<
  typeof repositoryLayoutContractSchema
>;

export function parseRepositoryLayoutContract(
  value: unknown,
): RepositoryLayoutContract {
  return parseContract(
    value,
    repositoryLayoutContractSchema,
    "repository layout contract",
  );
}
