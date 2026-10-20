#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseProjectPlan,
  parseTemplateRegistry,
  type TemplateSource,
} from "./contracts.js";
import {
  executeProjectPlan,
  type GenerationMode,
} from "./engine.js";

const DEFAULT_REGISTRY =
  "ui/content/projects/personal-engineering-platform/project-template-sources.yaml";

interface CliInput {
  readonly mode: GenerationMode;
  readonly planPath: string;
  readonly repository: string;
  readonly registryPath: string;
}

function usage(): string {
  return [
    "Usage: project-generator <plan|dry-run|create|update> <plan.yaml> [options]",
    "",
    "Options:",
    "  --repository <path>  Existing Git checkout to manage, defaults to cwd",
    `  --registry <path>    Trusted template registry, defaults to ${DEFAULT_REGISTRY}`,
  ].join("\n");
}

export function parseCliArguments(args: readonly string[]): CliInput {
  const [mode, planPath, ...options] = args;
  if (!mode || !["plan", "dry-run", "create", "update"].includes(mode)) {
    throw new Error(usage());
  }
  if (!planPath || planPath.startsWith("--")) throw new Error(usage());
  let repository = process.cwd();
  let registryPath = DEFAULT_REGISTRY;
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index];
    const value = options[index + 1];
    if (!value || (option !== "--repository" && option !== "--registry")) {
      throw new Error(usage());
    }
    if (option === "--repository") repository = value;
    else registryPath = value;
  }
  return {
    mode: mode as GenerationMode,
    planPath: path.resolve(planPath),
    repository: path.resolve(repository),
    registryPath: path.resolve(registryPath),
  };
}

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

export async function main(args = process.argv.slice(2)): Promise<void> {
  const input = parseCliArguments(args);
  const [planSource, registrySource] = await Promise.all([
    readFile(input.planPath, "utf8"),
    readFile(input.registryPath, "utf8"),
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
    repository: input.repository,
    mode: input.mode,
    plan,
    template: resolveTemplateSource(selected, input.registryPath),
  });
  if (input.mode === "dry-run") {
    process.stdout.write(result.diff || "No changes.\n");
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
/* v8 ignore start -- exercised by invoking the CLI through mise */
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
