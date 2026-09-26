#!/usr/bin/env node

import { appendFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
import { runReviewSession, type ReviewAnswer } from "./review-session";

const ReviewManifestSchema = ReviewRecordsSchema.extend({
  sourcePath: z.string().trim().min(1),
}).strict();

export async function main(
  args = process.argv.slice(2),
  streams?: { input: Readable; output: Writable },
): Promise<void> {
  const io = streams ?? { input: process.stdin, output: process.stdout };
  const parsedArgs = parseArgs(args);
  const manifestPath = resolve(parsedArgs.manifestPath);
  const manifestDirectory = dirname(manifestPath);
  const manifest = ReviewManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const sourcePath = resolve(manifestDirectory, manifest.sourcePath);
  const decisionsPath = resolve(
    manifestDirectory,
    parsedArgs.decisionsPath ?? `${manifest.sourcePath}.decisions.jsonl`,
  );
  if (decisionsPath === sourcePath || decisionsPath === manifestPath) {
    throw new Error("the decision log must not overwrite the source or manifest");
  }
  const source = await readFile(sourcePath, "utf8");
  const records = prepareReviewRecords({
    documentId: manifest.documentId,
    revision: manifest.revision,
    findings: manifest.findings,
    proposals: manifest.proposals,
  }, source);
  const existingDecisions = await readDecisionLog(decisionsPath);

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
          `${renderProposalDiff(proposal, source, manifest.sourcePath)}\n`,
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
    io.output.write(
      `Review complete. Recorded ${result.decisions.length} decisions and applied the selected edits.\n`,
    );
  } finally {
    prompts.close();
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

function parseArgs(args: string[]): {
  manifestPath: string;
  decisionsPath?: string;
} {
  const [manifestPath, flag, decisionsPath, ...rest] = args;
  if (!manifestPath || rest.length > 0 || (flag && flag !== "--decisions") ||
    (flag === "--decisions" && !decisionsPath)) {
    throw new Error(
      "usage: mise //packages/writing-editor-domain:review -- <manifest.json> [--decisions <decisions.jsonl>]",
    );
  }
  return { manifestPath, ...(decisionsPath ? { decisionsPath } : {}) };
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
