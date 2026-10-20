import { spawn } from "node:child_process";

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

export async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
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
