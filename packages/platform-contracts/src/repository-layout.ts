import { z } from "zod";
import { parseContract } from "./parse";

export const repositoryLayoutNamedRecordSchema = z
  .object({
    id: z.string(),
    description: z.string().optional(),
    task_profile: z.string().optional(),
  })
  .strict();

export const repositoryLayoutComponentKindSchema =
  repositoryLayoutNamedRecordSchema
    .extend({
      directory: z.string(),
      mise_config_root: z.boolean().default(true),
      pnpm_workspace_package: z.boolean().default(false),
      delegated_task_project: z
        .string()
        .regex(/^\/\/[a-z0-9][a-z0-9./-]*$/)
        .optional(),
    })
    .strict();

export const repositoryLayoutProjectRegistrationSchema =
  repositoryLayoutNamedRecordSchema
    .extend({ kind: z.string(), catalog_record: z.string() })
    .strict();

export const repositoryLayoutSharedManifestSchema = z
  .object({ path: z.string(), allowed_edits: z.array(z.string()) })
  .strict();

export const repositoryLayoutContractSchema = z
  .object({
    schema_version: z.literal(1),
    project_kinds: z.array(repositoryLayoutNamedRecordSchema),
    projects: z.array(repositoryLayoutProjectRegistrationSchema),
    component_kinds: z.array(repositoryLayoutComponentKindSchema),
    task_contract: z
      .object({ id: z.string(), required: z.array(z.string()) })
      .strict(),
    knowledge_graph: z
      .object({
        project_index: z.string(),
        architecture_decisions: z.string(),
        product_decisions: z.string(),
      })
      .strict(),
    shared_manifests: z.array(repositoryLayoutSharedManifestSchema),
    workspace_policy: z
      .object({
        node_workspace: z.string(),
        node_lockfile: z.string(),
        standalone_node_roots: z.array(z.string()),
        approved_npm_lockfiles: z.array(z.string()),
        local_mise_roots: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export type RepositoryLayoutNamedRecord = z.infer<
  typeof repositoryLayoutNamedRecordSchema
>;
export type RepositoryLayoutComponentKind = z.infer<
  typeof repositoryLayoutComponentKindSchema
>;
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
