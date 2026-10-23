#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initTRPC } from "@trpc/server";
import {
  createCli,
  FailedToExitError,
  type TrpcCliMeta,
} from "trpc-cli";
import { z } from "zod";
import {
  parseProjectPlan,
  parseTemplateRegistry,
  type TemplateSource,
} from "./contracts.js";
import {
  executeProjectPlan,
  planProjectAdoption,
  type GenerationMode,
  type GenerationResult,
} from "./engine.js";
import {
  projectPlanFromBlueprint,
  requirePinnedTemplate,
} from "./profile-plan.js";
import {
  parseProjectProfile,
  parseProjectProfileContracts,
  resolveProjectProfile,
} from "./profile.js";
import {
  applyProjectReconciliation,
  planProjectReconciliation,
} from "./reconciliation.js";

const DEFAULT_REGISTRY =
  "ui/content/projects/personal-engineering-platform/project-template-sources.yaml";
const DEFAULT_CONTRACT_DIRECTORY =
  "ui/content/projects/personal-engineering-platform";
const DEFAULT_TEMPLATE_ID = "monorepo-project";

interface CommandContext {
  readonly workingDirectory: string;
}

export interface CliDependencies {
  readonly stderr?: (text: string) => void;
  readonly stdout?: (text: string) => void;
  readonly workingDirectory?: string;
}

const t = initTRPC.context<CommandContext>().meta<TrpcCliMeta>().create();

const projectCommandInput = z.object({
  planPath: z
    .string()
    .describe("Project plan YAML path")
    .meta({ positional: true }),
  repository: z
    .string()
    .optional()
    .describe("Existing Git checkout to manage; defaults to cwd"),
  registry: z
    .string()
    .optional()
    .describe(`Trusted template registry; defaults to ${DEFAULT_REGISTRY}`),
});

type ProjectCommandInput = z.infer<typeof projectCommandInput>;

const profileCommandInput = z.object({
  profilePath: z
    .string()
    .describe("Versioned project profile YAML path")
    .meta({ positional: true }),
  effectiveAt: z
    .string()
    .describe("Explicit RFC 3339 UTC instant used to resolve platform defaults"),
  templateId: z
    .string()
    .optional()
    .describe(`Trusted template ID; defaults to ${DEFAULT_TEMPLATE_ID}`),
  contracts: z
    .string()
    .optional()
    .describe(`Platform contract directory; defaults to ${DEFAULT_CONTRACT_DIRECTORY}`),
  repository: z
    .string()
    .optional()
    .describe("Existing Git checkout to manage; defaults to cwd"),
  registry: z
    .string()
    .optional()
    .describe(`Trusted template registry; defaults to ${DEFAULT_REGISTRY}`),
});

type ProfileCommandInput = z.infer<typeof profileCommandInput>;

const reconciliationApplyInput = profileCommandInput.extend({
  reviewedPlan: z
    .string()
    .describe("Reviewed reconciliation plan JSON path"),
});

const reviewedPlanSchema = z.looseObject({
    schemaVersion: z.literal(1),
    kind: z.literal("project_reconciliation"),
    projectId: z.string().min(1),
    status: z.literal("ready"),
    baseRevision: z.string().regex(/^[0-9a-f]{40}$/),
    targetEffectiveAt: z.string().min(1),
    candidate: z.looseObject({ diff: z.string() }),
    planDigest: z.string().regex(/^[0-9a-f]{64}$/),
  });

function resolveTemplateSource(
  template: TemplateSource,
  registryPath: string,
): TemplateSource {
  const source = template.source;
  if (
    path.isAbsolute(source) ||
    /^[a-z][a-z0-9+.-]*:/i.test(source) ||
    source.startsWith("git@")
  ) {
    return template;
  }
  return {
    ...template,
    source: path.resolve(path.dirname(registryPath), source),
  };
}

async function runProjectCommand(
  context: CommandContext,
  input: ProjectCommandInput,
  mode: GenerationMode,
): Promise<GenerationResult | string> {
  const planPath = path.resolve(context.workingDirectory, input.planPath);
  const repository = path.resolve(
    context.workingDirectory,
    input.repository ?? ".",
  );
  const registryPath = path.resolve(
    context.workingDirectory,
    input.registry ?? DEFAULT_REGISTRY,
  );
  const [planSource, registrySource] = await Promise.all([
    readFile(planPath, "utf8"),
    readFile(registryPath, "utf8"),
  ]);
  const plan = parseProjectPlan(planSource);
  const registry = parseTemplateRegistry(registrySource);
  const selected = registry.templates.find(({ id }) => id === plan.template_id);
  if (!selected) {
    throw new Error(
      `Template '${plan.template_id}' is not present in the trusted registry`,
    );
  }
  const result = await executeProjectPlan({
    repository,
    mode,
    plan,
    template: resolveTemplateSource(selected, registryPath),
  });
  return mode === "dry-run" ? result.diff || "No changes.\n" : result;
}

async function runProfileCommand(
  context: CommandContext,
  input: ProfileCommandInput,
  mode: GenerationMode,
): Promise<GenerationResult | string> {
  const prepared = await prepareProfileCommand(context, input);
  const result = await executeProjectPlan({
    repository: prepared.repository,
    mode,
    plan: prepared.plan,
    template: prepared.template,
  });
  return mode === "dry-run" ? result.diff || "No changes.\n" : result;
}

async function prepareProfileCommand(
  context: CommandContext,
  input: ProfileCommandInput,
) {
  const resolvePath = (value: string) =>
    path.resolve(context.workingDirectory, value);
  const profilePath = resolvePath(input.profilePath);
  const repository = resolvePath(input.repository ?? ".");
  const registryPath = resolvePath(input.registry ?? DEFAULT_REGISTRY);
  const contractDirectory = resolvePath(
    input.contracts ?? DEFAULT_CONTRACT_DIRECTORY,
  );
  const [profileSource, registrySource, layout, platform, nix, opentelemetry] =
    await Promise.all([
      readFile(profilePath, "utf8"),
      readFile(registryPath, "utf8"),
      readFile(path.join(contractDirectory, "repository-layout.yaml"), "utf8"),
      readFile(path.join(contractDirectory, "platform.yaml"), "utf8"),
      readFile(path.join(contractDirectory, "nix-flake-contract.yaml"), "utf8"),
      readFile(
        path.join(contractDirectory, "opentelemetry-contract.yaml"),
        "utf8",
      ),
    ]);
  const profile = parseProjectProfile(profileSource);
  const contracts = parseProjectProfileContracts({
    layout,
    platform,
    nix,
    opentelemetry,
  });
  const blueprint = resolveProjectProfile(
    profile,
    contracts,
    input.effectiveAt,
  );
  const registry = parseTemplateRegistry(registrySource);
  const templateId = input.templateId ?? DEFAULT_TEMPLATE_ID;
  const selected = registry.templates.find(({ id }) => id === templateId);
  if (!selected) {
    throw new Error(
      `Template '${templateId}' is not present in the trusted registry`,
    );
  }
  const template = requirePinnedTemplate(
    resolveTemplateSource(selected, registryPath),
  );
  const plan = projectPlanFromBlueprint({ blueprint, contracts, template });
  return { blueprint, contracts, plan, profile, repository, template };
}

async function runProfileAdoptionPlanCommand(
  context: CommandContext,
  input: ProfileCommandInput,
) {
  const prepared = await prepareProfileCommand(context, input);
  return planProjectAdoption(prepared);
}

async function runProfileReconciliationCommand(
  context: CommandContext,
  input: ProfileCommandInput,
) {
  const prepared = await prepareProfileCommand(context, input);
  return planProjectReconciliation(prepared);
}

async function runProfileReconciliationApplyCommand(
  context: CommandContext,
  input: z.infer<typeof reconciliationApplyInput>,
) {
  const prepared = await prepareProfileCommand(context, input);
  const reviewedPlanPath = path.resolve(
    context.workingDirectory,
    input.reviewedPlan,
  );
  const reviewedPlan = reviewedPlanSchema.parse(
    JSON.parse(await readFile(reviewedPlanPath, "utf8")),
  );
  if (reviewedPlan.projectId !== prepared.blueprint.project.id) {
    throw new Error(
      `Reviewed plan is for project '${reviewedPlan.projectId}', not '${prepared.blueprint.project.id}'`,
    );
  }
  return applyProjectReconciliation({
    ...prepared,
    reviewedPlanDigest: reviewedPlan.planDigest,
  });
}

export const projectGeneratorRouter = t.router({
  plan: t.procedure
    .meta({
      description: "Produce a machine-readable Copier project change plan",
    })
    .input(projectCommandInput)
    .query(({ ctx, input }) => runProjectCommand(ctx, input, "plan")),
  dryRun: t.procedure
    .meta({
      description: "Render and check a Copier project change without applying it",
    })
    .input(projectCommandInput)
    .query(({ ctx, input }) => runProjectCommand(ctx, input, "dry-run")),
  create: t.procedure
    .meta({
      description: "Create a Copier-managed project in the current monorepo",
    })
    .input(projectCommandInput)
    .mutation(({ ctx, input }) => runProjectCommand(ctx, input, "create")),
  update: t.procedure
    .meta({
      description: "Update a Copier-managed project in the current monorepo",
    })
    .input(projectCommandInput)
    .mutation(({ ctx, input }) => runProjectCommand(ctx, input, "update")),
  profilePlan: t.procedure
    .meta({
      description: "Resolve a project profile and produce a checked Copier plan",
    })
    .input(profileCommandInput)
    .query(({ ctx, input }) => runProfileCommand(ctx, input, "plan")),
  profileAdoptionPlan: t.procedure
    .meta({
      description:
        "Plan Copier adoption for an existing project without an answers file",
    })
    .input(profileCommandInput)
    .query(({ ctx, input }) => runProfileAdoptionPlanCommand(ctx, input)),
  profileReconcile: t.procedure
    .meta({
      description:
        "Plan a reviewed update from the recorded blueprint to newer platform defaults",
    })
    .input(profileCommandInput)
    .query(({ ctx, input }) => runProfileReconciliationCommand(ctx, input)),
  profileReconcileApply: t.procedure
    .meta({
      description: "Apply an unchanged reviewed project reconciliation plan",
    })
    .input(reconciliationApplyInput)
    .mutation(({ ctx, input }) =>
      runProfileReconciliationApplyCommand(ctx, input),
    ),
  profileDryRun: t.procedure
    .meta({
      description: "Preview a resolved project profile without applying it",
    })
    .input(profileCommandInput)
    .query(({ ctx, input }) => runProfileCommand(ctx, input, "dry-run")),
  profileCreate: t.procedure
    .meta({
      description: "Create a Copier-managed project from a resolved profile",
    })
    .input(profileCommandInput)
    .mutation(({ ctx, input }) => runProfileCommand(ctx, input, "create")),
  profileUpdate: t.procedure
    .meta({
      description: "Apply a reviewed project reconciliation plan",
    })
    .input(reconciliationApplyInput)
    .mutation(({ ctx, input }) =>
      runProfileReconciliationApplyCommand(ctx, input),
    ),
});

export async function runCli(
  args = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout =
    dependencies.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr =
    dependencies.stderr ?? ((text: string) => process.stderr.write(text));
  const cli = createCli({
    router: projectGeneratorRouter,
    context: {
      workingDirectory: dependencies.workingDirectory ?? process.cwd(),
    },
    name: "project-generator",
    version: "0.1.0",
    description: "Safe Copier lifecycle for projects in the shared monorepo",
    jsonInput: "auto",
  });

  try {
    await cli.run({
      argv: [...args],
      prompts: false,
      process: { exit: () => undefined as never },
      logger: {
        info: (value: unknown) => {
          if (typeof value === "string") {
            stdout(value.endsWith("\n") ? value : `${value}\n`);
          } else {
            stdout(`${JSON.stringify(value, null, 2)}\n`);
          }
        },
        error: (value: unknown) => {
          const message = value instanceof Error ? value.message : String(value);
          stderr(message.endsWith("\n") ? message : `${message}\n`);
        },
      },
    });
    return 0;
  } catch (error) {
    if (error instanceof FailedToExitError) return error.exitCode;
    throw error;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
/* v8 ignore start -- exercised by invoking the CLI through mise */
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
/* v8 ignore stop */
