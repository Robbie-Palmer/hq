import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { z, type ZodType } from "zod";
import type { Env, ReviewWorkflowParams } from "../src/env";
import {
  createProductionReplayAdapter,
  runControlledReplay,
  type ReplayCorpusStore,
} from "../src/replay-runner";
import {
  ReplayExperimentSchema,
  ReplayLimitsSchema,
  ReplayProviderListSchema,
  ReplayProviderSchema,
  type ReplayExperiment,
  type ReplayProvider,
} from "ai-review-domain/replay";
import { exclusiveClaim } from "./replay-claim";

function option<T>(schema: ZodType<T>, value: unknown, name: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`${name}: ${z.prettifyError(result.error)}`);
  return result.data;
}

const RequiredStringSchema = z.string().trim().min(1);
const PositiveNumberSchema = z.coerce.number().positive();
const PositiveIntegerSchema = z.coerce.number().int().positive();
const NonNegativeIntegerSchema = z.coerce.number().int().nonnegative();

function loadExperiment(file: string): ReplayExperiment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new Error(`cannot read --experiment JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--experiment must contain one replay experiment object");
  }
  return option(ReplayExperimentSchema, parsed, "--experiment");
}

function providerList(value: string | undefined): ReplayProvider[] {
  const providers = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return option(ReplayProviderListSchema, providers, "--allowed-providers");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      snapshot: { type: "string" },
      "corpus-id": { type: "string" },
      output: { type: "string" },
      model: { type: "string" },
      provider: { type: "string", default: "openrouter" },
      experiment: { type: "string" },
      "allowed-providers": { type: "string", default: "openrouter" },
      "max-models": { type: "string", default: "1" },
      "max-cost-usd": { type: "string", default: "0.25" },
      "max-scout-tokens": { type: "string", default: "8000" },
      "max-merger-tokens": { type: "string", default: "6000" },
      "max-repetitions": { type: "string" },
      "timeout-ms": { type: "string", default: "120000" },
      repetition: { type: "string", default: "0" },
      "require-zero-data-retention": { type: "boolean", default: false },
      execute: { type: "boolean", default: false },
    },
  });
  const snapshotFile = path.resolve(option(RequiredStringSchema, values.snapshot, "--snapshot"));
  const corpusId = option(z.string().regex(/^[a-f0-9]{64}$/, "must be the snapshot SHA-256"), values["corpus-id"], "--corpus-id");
  const outputRoot = path.resolve(option(RequiredStringSchema, values.output, "--output"));
  const provider = option(ReplayProviderSchema, values.provider, "--provider");
  const repetition = option(NonNegativeIntegerSchema, values.repetition, "--repetition");
  const maxRepetitions = values["max-repetitions"] === undefined
    ? repetition + 1
    : option(PositiveIntegerSchema, values["max-repetitions"], "--max-repetitions");
  if (repetition >= maxRepetitions) {
    throw new Error("--repetition must be less than --max-repetitions");
  }
  const experiment: ReplayExperiment = values.experiment
    ? loadExperiment(values.experiment)
    : {
        kind: "scout-model",
        models: [{ model: option(RequiredStringSchema, values.model, "--model"), provider }],
      };
  const limits = option(ReplayLimitsSchema, {
    maxModels: option(PositiveIntegerSchema, values["max-models"], "--max-models"),
    maxScoutTokens: option(PositiveIntegerSchema, values["max-scout-tokens"], "--max-scout-tokens"),
    maxMergerTokens: option(PositiveIntegerSchema, values["max-merger-tokens"], "--max-merger-tokens"),
    maxCostUsd: option(PositiveNumberSchema, values["max-cost-usd"], "--max-cost-usd"),
    allowedProviders: providerList(values["allowed-providers"]),
    requireZeroDataRetention: values["require-zero-data-retention"],
    timeoutMs: option(PositiveIntegerSchema, values["timeout-ms"], "--timeout-ms"),
    maxRepetitions,
  }, "replay limits");
  const store: ReplayCorpusStore = {
    loadSnapshot: async (requestedCorpusId) => {
      if (requestedCorpusId !== corpusId) return null;
      const content = fs.readFileSync(snapshotFile, "utf8");
      const digest = createHash("sha256").update(content).digest("hex");
      if (digest !== corpusId) throw new Error("snapshot content does not match --corpus-id");
      return content;
    },
    get: async (key) => {
      const file = path.join(outputRoot, key);
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    },
    claim: async (key, staleAfterMs) => exclusiveClaim(
      path.join(outputRoot, `${key}.claim`),
      staleAfterMs,
    ),
    put: async (key, value) => {
      const file = path.join(outputRoot, key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${value}\n`, { flag: "wx" });
    },
  };
  const params: ReviewWorkflowParams = {
    deliveryId: `replay-${corpusId}`,
    eventName: "controlled-replay",
    action: values.execute ? "execute" : "plan",
    repository: process.env.AI_REVIEW_REPOSITORY ?? "Robbie-Palmer/hq",
    pullRequestNumber: 0,
    force: false,
  };
  const env = process.env as unknown as Env;
  const adapter = createProductionReplayAdapter({ env, params, limits });
  const result = await runControlledReplay({
    corpusId,
    experiment,
    limits,
    repetition,
    dryRun: !values.execute,
  }, adapter, store);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
