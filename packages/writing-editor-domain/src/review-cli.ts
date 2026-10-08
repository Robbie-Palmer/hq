#!/usr/bin/env node

import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import { z } from "zod";

import { type Decision, DecisionSchema } from "./decisions";
import {
  prepareReviewRecords,
  renderFinding,
  renderProposalDiff,
  ReviewRecordsSchema,
} from "./review";
import { createReviewReceipt } from "./review-receipt";
import { runReviewSession, type ReviewAnswer } from "./review-session";
import { runValeDeterministicProducer } from "./vale-producer";

const ReviewManifestSchema = ReviewRecordsSchema.extend({
  sourcePath: z.string().trim().min(1),
}).strict();

export async function main(
  args = process.argv.slice(2),
  streams?: { input: Readable; output: Writable },
): Promise<void> {
  const io = streams ?? { input: process.stdin, output: process.stdout };
  const parsedArgs = parseArgs(args);
  const input = await loadReviewInput(parsedArgs);
  const { sourcePath, decisionsPath } = input;
  const source = await readFile(sourcePath, "utf8");
  const unpreparedRecords = input.mode === "manifest"
    ? input.records
    : runValeDeterministicProducer({
      source,
      sourcePath,
      documentId: input.documentId,
      revision: input.revision,
      configPath: input.configPath,
      ...(input.valeBinary ? { valeBinary: input.valeBinary } : {}),
    });
  const records = prepareReviewRecords(unpreparedRecords, source);
  if (input.mode === "source") {
    await mkdir(dirname(input.recordsPath), { recursive: true });
    await writeFile(input.recordsPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    io.output.write(`Producer records: ${input.recordsPath}\n`);
  }
  const existingDecisions = await readDecisionLog(decisionsPath);
  await mkdir(dirname(decisionsPath), { recursive: true });

  io.output.write(`Detection-only findings (${records.findings.length})\n\n`);
  for (const finding of records.findings) {
    io.output.write(`${renderFinding(finding)}\n\n`);
  }
  io.output.write(`Actionable proposals (${records.proposals.length})\n\n`);

  const prompts = createInterface(io);
  try {
    const result = await runReviewSession({
      source,
      records,
      existingDecisions,
      decide: async (proposal) => {
        io.output.write(
          `${renderProposalDiff(proposal, source, input.displayPath)}\n`,
        );
        return promptForDecision(prompts, io.output);
      },
      recordDecision: async (decision) => {
        await appendFile(decisionsPath, `${JSON.stringify(decision)}\n`, "utf8");
      },
    });

    if (result.status === "paused") {
      io.output.write(
        "Review paused. Recorded decisions are durable; source is unchanged.\n",
      );
      return;
    }

    if (result.source !== source) {
      await atomicWrite(sourcePath, result.source);
    }
    if (input.mode === "source" && input.receiptPath) {
      const receipt = createReviewReceipt(records, result.decisions, source, result.source);
      await mkdir(dirname(input.receiptPath), { recursive: true });
      await writeFile(input.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      io.output.write(`Review receipt: ${input.receiptPath}\n`);
    }
    io.output.write(
      `Review complete. Recorded ${result.decisions.length} decisions and applied the selected edits.\n`,
    );
  } finally {
    prompts.close();
  }
}

type ParsedArgs =
  | { mode: "manifest"; manifestPath: string; decisionsPath?: string }
  | {
    mode: "source";
    sourcePath: string;
    revision: string;
    documentId?: string;
    decisionsPath?: string;
    recordsPath?: string;
    receiptPath?: string;
    configPath?: string;
    valeBinary?: string;
  };

type ReviewInput =
  | {
    mode: "manifest";
    sourcePath: string;
    decisionsPath: string;
    displayPath: string;
    records: z.infer<typeof ReviewRecordsSchema>;
  }
  | {
    mode: "source";
    sourcePath: string;
    decisionsPath: string;
    displayPath: string;
    recordsPath: string;
    receiptPath?: string;
    documentId: string;
    revision: string;
    configPath: string;
    valeBinary?: string;
  };

async function loadReviewInput(parsed: ParsedArgs): Promise<ReviewInput> {
  if (parsed.mode === "source") {
    const sourcePath = resolve(parsed.sourcePath);
    const decisionsPath = resolve(parsed.decisionsPath ?? `${parsed.sourcePath}.decisions.jsonl`);
    const recordsPath = resolve(parsed.recordsPath ?? `${parsed.sourcePath}.review.json`);
    const receiptPath = parsed.receiptPath ? resolve(parsed.receiptPath) : undefined;
    assertDistinctPaths(
      sourcePath,
      decisionsPath,
      recordsPath,
      ...(receiptPath ? [receiptPath] : []),
    );
    return {
      ...parsed,
      sourcePath,
      decisionsPath,
      recordsPath,
      ...(receiptPath ? { receiptPath } : {}),
      displayPath: parsed.sourcePath,
      documentId: parsed.documentId ?? relative(process.cwd(), sourcePath),
      configPath: resolve(parsed.configPath ?? ".vale.ini"),
    };
  }
  const manifestPath = resolve(parsed.manifestPath);
  const manifestDirectory = dirname(manifestPath);
  const manifest = ReviewManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const sourcePath = resolve(manifestDirectory, manifest.sourcePath);
  const decisionsPath = resolve(
    manifestDirectory,
    parsed.decisionsPath ?? `${manifest.sourcePath}.decisions.jsonl`,
  );
  assertDistinctPaths(sourcePath, decisionsPath, manifestPath);
  return {
    mode: "manifest",
    sourcePath,
    decisionsPath,
    displayPath: manifest.sourcePath,
    records: {
      documentId: manifest.documentId,
      revision: manifest.revision,
      findings: manifest.findings,
      proposals: manifest.proposals,
    },
  };
}

function assertDistinctPaths(...paths: string[]): void {
  if (new Set(paths).size !== paths.length) {
    throw new Error(
      "the decision log and producer records must not overwrite the source or manifest",
    );
  }
}

async function promptForDecision(
  prompts: ReturnType<typeof createInterface>,
  output: Writable,
): Promise<ReviewAnswer> {
  for (;;) {
    const answer = (await prompts.question(
      "[a]ccept, [r]eject, [c]hange, or [q]uit: ",
    )).trim().toLowerCase();
    if (answer === "a" || answer === "accept") return { outcome: "accepted" };
    if (answer === "r" || answer === "reject") return { outcome: "rejected" };
    if (answer === "q" || answer === "quit") return { outcome: "quit" };
    if (answer === "c" || answer === "change") {
      const replacement = await prompts.question("Replacement text: ");
      return { outcome: "changed", replacement };
    }
    output.write("Enter a, r, c, or q.\n");
  }
}

async function readDecisionLog(path: string): Promise<Decision[]> {
  let value: string;
  try {
    value = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  return value.split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return DecisionSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`invalid decision at ${path}:${index + 1}`, { cause: error });
      }
    });
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.writing-editor-${process.pid}.tmp`;
  const sourceStats = await stat(path);
  await writeFile(temporaryPath, content, {
    encoding: "utf8",
    mode: sourceStats.mode,
  });
  await rename(temporaryPath, path);
}

function parseArgs(args: string[]): ParsedArgs {
  if (args[0] === "--source") return parseSourceArgs(args);
  const [manifestPath, flag, decisionsPath, ...rest] = args;
  if (!manifestPath || rest.length > 0 || (flag && flag !== "--decisions") ||
    (flag === "--decisions" && !decisionsPath)) {
    throw new Error(
      "usage: mise //packages/writing-editor-domain:review -- <manifest.json> [--decisions <decisions.jsonl>]",
    );
  }
  return { mode: "manifest", manifestPath, ...(decisionsPath ? { decisionsPath } : {}) };
}

function parseSourceArgs(args: string[]): Extract<ParsedArgs, { mode: "source" }> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(sourceUsage());
    }
    if (values.has(flag)) throw new Error(`duplicate argument ${flag}`);
    values.set(flag, value);
  }
  const allowed = new Set([
    "--source",
    "--revision",
    "--document-id",
    "--decisions",
    "--records",
    "--receipt",
    "--config",
    "--vale",
  ]);
  const unknown = [...values.keys()].find((flag) => !allowed.has(flag));
  if (unknown) throw new Error(`unknown argument ${unknown}\n${sourceUsage()}`);
  const sourcePath = values.get("--source");
  const revision = values.get("--revision");
  if (!sourcePath || !revision) throw new Error(sourceUsage());
  return {
    mode: "source",
    sourcePath,
    revision,
    ...(values.get("--document-id") ? { documentId: values.get("--document-id") } : {}),
    ...(values.get("--decisions") ? { decisionsPath: values.get("--decisions") } : {}),
    ...(values.get("--records") ? { recordsPath: values.get("--records") } : {}),
    ...(values.get("--receipt") ? { receiptPath: values.get("--receipt") } : {}),
    ...(values.get("--config") ? { configPath: values.get("--config") } : {}),
    ...(values.get("--vale") ? { valeBinary: values.get("--vale") } : {}),
  };
}

function sourceUsage(): string {
  return "usage: mise //packages/writing-editor-domain:review -- --source <file> --revision <revision> [--document-id <id>] [--records <records.json>] [--decisions <decisions.jsonl>] [--receipt <receipt.json>] [--config <.vale.ini>] [--vale <binary>]";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
