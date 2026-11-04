import path from "node:path";
import { z } from "zod";
import { LOWERCASE_KEBAB_CASE_PATTERN } from "ts-base/strings";

const slugSchema = z.string().regex(LOWERCASE_KEBAB_CASE_PATTERN);
const repositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const subjectIdSchema = z
  .string()
  .regex(/^(?:component|workload):[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/);

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

const sourcePathBindingSchema = z
  .object({
    path: repositoryPathSchema,
    mode: z.enum(["exclusive", "shared"]),
  })
  .strict();

const githubEvidenceSchema = z
  .object({
    required_ci_names: z.array(z.string().trim().min(1)).min(1),
    production_environments: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((evidence, context) => {
    addDuplicateIssues(
      evidence.required_ci_names,
      "required CI name",
      ["required_ci_names"],
      context,
    );
    addDuplicateIssues(
      evidence.production_environments,
      "production environment",
      ["production_environments"],
      context,
    );
  });

const deliveryTargetBindingSchema = z
  .object({
    id: slugSchema,
    subjects: z.array(subjectIdSchema).default([]),
    shared_host: slugSchema.optional(),
    source_paths: z.array(sourcePathBindingSchema).default([]),
    github: githubEvidenceSchema,
  })
  .strict()
  .superRefine((target, context) => {
    if (target.subjects.length === 0 && target.source_paths.length === 0) {
      context.addIssue({
        code: "custom",
        message: "must declare at least one subject or source path",
      });
    }
    addDuplicateIssues(target.subjects, "subject", ["subjects"], context);
    addDuplicateIssues(
      target.source_paths.map(({ path: sourcePath }) => sourcePath),
      "source path",
      ["source_paths"],
      context,
    );
  });

export const deliveryEvidenceContractSchema = z
  .object({
    contract: z.literal("project-delivery-evidence"),
    contract_version: z.literal(1),
    repository: repositorySchema,
    targets: z.array(deliveryTargetBindingSchema).min(1),
  })
  .strict()
  .superRefine((contract, context) => {
    addDuplicateIssues(
      contract.targets.map(({ id }) => id),
      "delivery target id",
      ["targets"],
      context,
    );

    const paths = new Map<string, Set<"exclusive" | "shared">>();
    for (const target of contract.targets) {
      for (const binding of target.source_paths) {
        const modes = paths.get(binding.path) ?? new Set();
        modes.add(binding.mode);
        paths.set(binding.path, modes);
      }
    }
    for (const [sourcePath, modes] of paths) {
      if (modes.size > 1) {
        context.addIssue({
          code: "custom",
          path: ["targets"],
          message: `source path '${sourcePath}' cannot be both exclusive and shared`,
        });
      }
    }
  });

export type DeliveryEvidenceContract = z.infer<
  typeof deliveryEvidenceContractSchema
>;

function addDuplicateIssues(
  values: readonly string[],
  label: string,
  path: readonly (string | number)[],
  context: z.RefinementCtx,
): void {
  const duplicate = values.find(
    (value, index) => values.indexOf(value) !== index,
  );
  if (duplicate) {
    context.addIssue({
      code: "custom",
      path: [...path],
      message: `duplicate ${label} '${duplicate}'`,
    });
  }
}
