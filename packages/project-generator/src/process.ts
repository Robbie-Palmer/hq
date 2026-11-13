import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly allowFailure?: boolean;
}

type SupportedCommand = "bash" | "copier" | "git" | "mise" | "pnpm";

export async function runCommand(
  command: SupportedCommand,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio:
      options.input === undefined
        ? ["ignore", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
  };
  let child: ChildProcess;
  switch (command) {
    case "bash":
      child = spawn("bash", args, spawnOptions);
      break;
    case "copier":
      child = spawn("copier", args, spawnOptions);
      break;
    case "git":
      child = spawn("git", args, spawnOptions);
      break;
    case "mise":
      child = spawn("mise", args, spawnOptions);
      break;
    case "pnpm":
      child = spawn("pnpm", args, spawnOptions);
      break;
  }
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  if (!child.stdout || !child.stderr) {
    throw new Error(`Failed to capture output from ${command}`);
  }
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  if (options.input !== undefined) {
    if (!child.stdin) throw new Error(`Failed to open input for ${command}`);
    child.stdin.end(options.input);
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  const result = {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    exitCode,
  };
  if (exitCode !== 0 && !options.allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${exitCode}${detail ? `: ${detail}` : ""}`,
    );
  }
  return result;
}
