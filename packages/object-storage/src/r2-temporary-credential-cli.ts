#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  parseR2ParentCredentials,
  recoverR2CredentialBroker,
  runR2CredentialBroker,
  type BrokerProcessRequest,
  type BrokerProcessResult,
} from "./r2-temporary-credential.js";

type ParsedArguments = {
  mode: "recover" | "run";
  bucketPrefix?: string;
  command?: string;
  commandArguments: readonly string[];
  helperCommand: string;
  receiptPath: string;
  ttlSeconds: number;
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

function optionValue(arguments_: readonly string[], name: string): string {
  const index = arguments_.indexOf(name);
  const value = index < 0 ? undefined : arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

export function parseR2CredentialBrokerArguments(
  arguments_: readonly string[],
): ParsedArguments {
  const mode = arguments_[0];
  if (mode !== "run" && mode !== "recover") {
    throw new Error("Pass run or recover as the broker mode");
  }
  const separator = arguments_.indexOf("--");
  const options = separator < 0 ? arguments_ : arguments_.slice(0, separator);
  const command = separator < 0 ? [] : arguments_.slice(separator + 1);
  if (mode === "run" && command.length === 0) {
    throw new Error("Broker run mode requires a consumer command after --");
  }
  const ttlSource = options.includes("--ttl-seconds")
    ? optionValue(options, "--ttl-seconds")
    : "1800";
  const ttlSeconds = Number(ttlSource);
  return {
    mode,
    ...(mode === "run"
      ? { bucketPrefix: optionValue(options, "--bucket-prefix") }
      : {}),
    ...(command[0] ? { command: command[0] } : {}),
    commandArguments: command.slice(1),
    helperCommand: optionValue(options, "--helper"),
    receiptPath: optionValue(options, "--receipt"),
    ttlSeconds,
  };
}

export async function runBrokerProcess(
  request: BrokerProcessRequest,
): Promise<BrokerProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, [...request.arguments], {
      env: { ...request.environment },
      stdio: request.inheritOutput ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (!request.inheritOutput) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({
        exitCode: signal ? 75 : (code ?? 1),
        stdout,
        stderr,
      });
    });
  });
}

async function main(): Promise<void> {
  const input = parseR2CredentialBrokerArguments(process.argv.slice(2));
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  const parentCredentials = parseR2ParentCredentials(
    requiredEnvironment("CLOUDFLARE_R2_PARENT_CREDENTIALS"),
  );
  if (input.mode === "recover") {
    await recoverR2CredentialBroker(
      {
        accountId,
        helperCommand: input.helperCommand,
        parentCredentials,
        receiptPath: input.receiptPath,
        ...(input.command ? { guardCommand: input.command } : {}),
        guardArguments: input.commandArguments,
        environment: process.env,
      },
      { runProcess: runBrokerProcess },
    );
    process.stdout.write("Recovered and deleted the recorded disposable R2 buckets.\n");
    return;
  }
  await runR2CredentialBroker(
    {
      accountId,
      bucketPrefix: input.bucketPrefix ?? "",
      command: input.command ?? "",
      commandArguments: input.commandArguments,
      helperCommand: input.helperCommand,
      parentCredentials,
      receiptPath: input.receiptPath,
      ttlSeconds: input.ttlSeconds,
      environment: process.env,
    },
    { runProcess: runBrokerProcess },
  );
  process.stdout.write(
    "Brokered R2 consumer completed; scope denial and bucket deletion were verified.\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
