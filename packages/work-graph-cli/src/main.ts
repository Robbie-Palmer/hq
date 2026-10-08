import {
  CliValidationError,
  type Command,
  createCli,
  FailedToExitError,
} from "trpc-cli";
import type { Fetch } from "./client.js";
import {
  createCommandContext,
  globalOptionsSchema,
  type CommandContext,
  type UuidFactory,
  workGraphRouter,
} from "./commands.js";
import {
  CliError,
  errorDocument,
  EXIT_CODES,
  type ExitCode,
  usageError,
} from "./errors.js";

export interface CliDependencies {
  environment?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  inspectPullRequest?: CommandContext["inspectPullRequest"];
  makeUuid?: UuidFactory;
  selfUpdate?: CommandContext["selfUpdate"];
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  workingDirectory?: string;
}

const collect = (value: string, previous: string[] = []): string[] => [
  ...previous,
  value,
];

const schemaDetail =
  /; (?:Min length|Max length|Minimum|Maximum|Format|Pattern):.*$/u;

interface HelpCommand {
  readonly commands: readonly HelpCommand[];
  readonly options: readonly { description: string }[];
}

const compactHelp = (command: HelpCommand): void => {
  for (const option of command.options) {
    option.description = option.description.replace(schemaDetail, "");
  }
  for (const child of command.commands) compactHelp(child);
};

// Keep contract field names for JSON input while exposing one value per flag.
const selectionFlags: Record<string, string> = {
  includeProjectIds: "project",
  excludeProjectIds: "exclude-project",
  includeInitiativeIds: "initiative",
  excludeInitiativeIds: "exclude-initiative",
  includeParentTitles: "parent-title",
  excludeParentTitles: "exclude-parent-title",
};

const configureSelectionFlags = (program: Command): void => {
  for (const command of program.commands) {
    if (!["ready", "queue", "claim", "critical-path"].includes(command.name()))
      continue;
    for (const option of command.options) {
      const key = option.attributeName();
      const flag = selectionFlags[key];
      if (flag === undefined) continue;
      const valueName = key.endsWith("ParentTitles") ? "title" : "id";
      option.flags = `--${flag} <${valueName}>`;
      option.short = `--${flag}`;
      option.required = true;
      option.optional = false;
      option.variadic = false;
      option.argParser(collect);
    }
    if (command.name() === "critical-path") {
      command.addHelpText(
        "after",
        "\nA bare --json prints JSON output. --json '<object>' supplies complete input; set outputJson to true for JSON output.\n",
      );
    }
    command.addHelpText(
      "after",
      "\nSelection: OR within each inclusion kind; AND across project, initiative, and parent-title inclusions.\nExclusions take precedence. Repeat a flag for each ID or title; parent titles ignore case. Values are literal, without CSV or sigils.\n",
    );
  }
};

const nestedCause = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "cause" in error
    ? error.cause
    : undefined;

const findCause = <ErrorType extends Error>(
  error: unknown,
  constructor: new (...args: never[]) => ErrorType,
): ErrorType | undefined => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && !seen.has(current)) {
    if (current instanceof constructor) return current;
    seen.add(current);
    current = nestedCause(current);
  }
  return undefined;
};

const validationMessage = (error: CliValidationError): string =>
  error.message.split("\n\nUsage:", 1)[0]?.trim() || "Invalid arguments.";

const toCliError = (cause: unknown): CliError => {
  const cliError = findCause(cause, CliError);
  if (cliError) return cliError;

  const validationError = findCause(cause, CliValidationError);
  if (validationError) return usageError(validationMessage(validationError));

  if (cause instanceof FailedToExitError && cause.exitCode !== 0) {
    const parserError = nestedCause(cause);
    const message =
      parserError instanceof Error
        ? parserError.message.replace(/^error:\s*/u, "")
        : "Invalid arguments.";
    return usageError(message);
  }

  return new CliError(
    "UNEXPECTED_ERROR",
    "The Work Graph CLI failed unexpectedly.",
    EXIT_CODES.transport,
    { cause },
  );
};

const rootCommand = (args: readonly string[]): string | undefined => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--api-url" || arg === "--cf-access-allowed-origin") {
      index += 1;
    } else if (
      !arg?.startsWith("--api-url=") &&
      !arg?.startsWith("--cf-access-allowed-origin=")
    ) {
      return arg;
    }
  }
  return undefined;
};

export const runCli = async (
  originalArgs: string[],
  dependencies: CliDependencies = {},
): Promise<ExitCode> => {
  // The existing bare critical-path --json flag selects output format.
  // A value after --json supplies complete input through trpc-cli.
  const commandName = rootCommand(originalArgs);
  const args = originalArgs.map((arg, index) =>
    commandName === "critical-path" &&
    arg === "--json" &&
    (originalArgs[index + 1] === undefined ||
      originalArgs[index + 1]?.startsWith("--"))
      ? "--output-json"
      : arg,
  );
  const stdout =
    dependencies.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr =
    dependencies.stderr ?? ((text: string) => process.stderr.write(text));

  const cli = createCli({
    router: workGraphRouter,
    context: createCommandContext({
      environment: dependencies.environment,
      fetch: dependencies.fetch,
      inspectPullRequest: dependencies.inspectPullRequest,
      makeUuid: dependencies.makeUuid,
      selfUpdate: dependencies.selfUpdate,
      workingDirectory: dependencies.workingDirectory,
    }),
    name: "work-graph",
    version: "0.1.0",
    description: "Agent-friendly client for the Work Graph REST API",
    jsonInput: "auto",
  });
  const runParameters = {
    argv: args,
    prompts: false as const,
    process: { exit: () => undefined as never },
    logger: {
      info: (value: unknown) =>
        stdout(
          typeof value === "string" ? value : `${JSON.stringify(value)}\n`,
        ),
      error: () => undefined,
    },
  };
  const program = cli.buildProgram(runParameters) as Command;
  program.option(
    "--api-url <url>",
    globalOptionsSchema.shape.apiUrl.description ?? "API base URL",
  );
  program.option(
    "--cf-access-allowed-origin <origin>",
    globalOptionsSchema.shape.cfAccessAllowedOrigin.description ??
      "Exact trusted Access origin",
    collect,
    [],
  );
  program.addHelpText(
    "after",
    [
      "",
      "Agent loop:",
      "  work-graph prime",
      "  work-graph ready",
      "  work-graph claim [ticket]",
      '  work-graph note <ticket> --content "progress or handoff"',
      "  work-graph release <ticket> --merge-evidence <url> --deployment-evidence <url>",
      "",
      "Production credentials load from Doppler automatically when needed.",
    ].join("\n"),
  );
  configureSelectionFlags(program);
  compactHelp(program);

  try {
    await cli.run(runParameters, program);
    return EXIT_CODES.success;
  } catch (cause) {
    if (cause instanceof FailedToExitError && cause.exitCode === 0) {
      return EXIT_CODES.success;
    }
    const error = toCliError(cause);
    stderr(`${JSON.stringify(errorDocument(error))}\n`);
    return error.exitCode;
  }
};
