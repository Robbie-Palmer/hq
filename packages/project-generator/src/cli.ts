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
  type GenerationMode,
  type GenerationResult,
} from "./engine.js";

const DEFAULT_REGISTRY =
  "ui/content/projects/personal-engineering-platform/project-template-sources.yaml";

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
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
/* v8 ignore stop */
