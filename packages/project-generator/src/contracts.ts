import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const MISE_TASK_PATTERN = /^\/\/[a-z0-9./-]*:[a-z0-9][a-z0-9:._-]*$/;
const SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:api_?key|credential|password|private_?key|secret|token)(?:$|_)/i;
const REFERENCE_KEY_PATTERN = /(?:_ref|_reference)$/i;

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const repositoryPathSchema = z.string().min(1).superRefine((value, context) => {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    value !== normalized ||
    path.posix.isAbsolute(value) ||
    normalized === "." ||
    segments.includes("") ||
    segments.includes(".") ||
    segments.includes("..") ||
    segments.includes(".git")
  ) {
    context.addIssue({
      code: "custom",
      message: "must be a normalized repository-relative path",
    });
  }
});

const ownedPathSchema = repositoryPathSchema.superRefine((value, context) => {
  if (value.split("/").length < 2 || value.startsWith(".copier/")) {
    context.addIssue({
      code: "custom",
      message: "must name a project-specific directory outside .copier",
    });
  }
});

const repositoryProjectSchema = z
  .object({
    id: z.string().regex(SLUG_PATTERN),
    kind: z.string().regex(SLUG_PATTERN),
    catalog_record: z.string().min(1),
  })
  .strict();

const catalogRecordSchema = z
  .record(z.string(), jsonValueSchema)
  .refine((value) => typeof value.id === "string" && value.id.length > 0, {
    message: "catalog records must have a non-empty string id",
  });

const sharedManifestEditSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mise_config_root"),
      value: repositoryPathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("pnpm_workspace_package"),
      value: repositoryPathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("repository_project"),
      value: repositoryProjectSchema,
      expected: repositoryProjectSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal("catalog_record"),
      value: catalogRecordSchema,
      expected: catalogRecordSchema.nullable().default(null),
    })
    .strict(),
]);

function findSensitiveAnswerKeys(
  value: JsonValue,
  location = "answers",
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findSensitiveAnswerKeys(entry, `${location}.${index}`),
    );
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(SENSITIVE_KEY_PATTERN.test(key) && !REFERENCE_KEY_PATTERN.test(key)
      ? [`${location}.${key}`]
      : []),
    ...findSensitiveAnswerKeys(entry, `${location}.${key}`),
  ]);
}

export const projectPlanSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: z.string().regex(SLUG_PATTERN),
    template_id: z.string().regex(SLUG_PATTERN),
    template_revision: z.string().regex(GIT_REVISION_PATTERN),
    answers: z.record(z.string(), jsonValueSchema),
    owned_paths: z.array(ownedPathSchema).min(1),
    shared_manifest_edits: z.array(sharedManifestEditSchema).default([]),
  })
  .strict()
  .superRefine((plan, context) => {
    const duplicatePath = plan.owned_paths.find(
      (candidate, index) => plan.owned_paths.indexOf(candidate) !== index,
    );
    if (duplicatePath) {
      context.addIssue({
        code: "custom",
        path: ["owned_paths"],
        message: `duplicate owned path '${duplicatePath}'`,
      });
    }
    for (const answerPath of findSensitiveAnswerKeys(plan.answers)) {
      context.addIssue({
        code: "custom",
        path: answerPath.split("."),
        message: "secret values are prohibited; store a reference with a _ref suffix",
      });
    }
  });

const templateSourceSchema = z
  .object({
    id: z.string().regex(SLUG_PATTERN),
    source: z.string().min(1),
    checks: z
      .array(z.string().regex(MISE_TASK_PATTERN))
      .default([]),
  })
  .strict()
  .superRefine((template, context) => {
    try {
      const url = new URL(template.source);
      if (url.username || url.password || url.search || url.hash) {
        context.addIssue({
          code: "custom",
          path: ["source"],
          message: "template sources must not contain credentials, query strings, or fragments",
        });
      }
    } catch {
      // Repository-owned registries may allowlist local Git paths.
    }
  });

export const templateRegistrySchema = z
  .object({
    schema_version: z.literal(1),
    templates: z.array(templateSourceSchema),
  })
  .strict()
  .superRefine((registry, context) => {
    const ids = registry.templates.map(({ id }) => id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate) {
      context.addIssue({
        code: "custom",
        path: ["templates"],
        message: `duplicate template id '${duplicate}'`,
      });
    }
  });

export type ProjectPlan = z.infer<typeof projectPlanSchema>;
export type SharedManifestEdit = z.infer<typeof sharedManifestEditSchema>;
export type TemplateRegistry = z.infer<typeof templateRegistrySchema>;
export type TemplateSource = z.infer<typeof templateSourceSchema>;

function parseDocument<T>(
  source: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  const parsed = schema.safeParse(parse(source));
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || label}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid ${label}: ${details}`);
}

export function parseProjectPlan(source: string): ProjectPlan {
  return parseDocument(source, projectPlanSchema, "project plan");
}

export function parseTemplateRegistry(source: string): TemplateRegistry {
  return parseDocument(source, templateRegistrySchema, "template registry");
}

export function answersPath(projectId: string): string {
  return `.copier/projects/${projectId}.yml`;
}
