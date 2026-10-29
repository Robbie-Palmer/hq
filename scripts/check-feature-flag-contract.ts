import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type FeatureFlagContract,
  type FeatureFlagRuntime,
  featureFlagRuntimeSchema,
  featureFlagRuntimeStateSchema,
  featureFlagValueTypeSchema,
  parseFeatureFlagContract,
} from "platform-contracts/feature-flags";
import { duplicateValues, setsEqual } from "ts-base/collections";
import { errorMessage } from "ts-base/errors";
import { parse } from "yaml";
import { z } from "zod";

const PROJECT_DIRECTORY =
  "ui/content/projects/personal-engineering-platform";
const CONTRACT_PATH = `${PROJECT_DIRECTORY}/feature-flag-contract.yaml`;
const TYPESCRIPT_PACKAGE_PATH = "packages/platform-contracts/package.json";
const PYTHON_PROJECT_PATH = "packages/platform-contracts/python/pyproject.toml";
const WORKER_CONFIG_PATH =
  "packages/platform-contracts/wrangler.feature-flags.toml";

const resultSchema = z
  .object({
    enabled: z.boolean(),
    variant: z.string().nullable(),
    payload: z.unknown(),
    reason: z.string().min(1),
  })
  .strict();

const expectedSchema = z
  .object({
    value: z.unknown(),
    variant: z.string().optional(),
    reason: z.string().min(1),
  })
  .strict();

const evaluationSchema = z
  .object({
    key: z.string().min(1),
    type: featureFlagValueTypeSchema,
    default: z.unknown(),
    result: resultSchema,
    expected: expectedSchema,
  })
  .strict();

const safeDefaultSchema = z
  .object({
    case: z.string().min(1),
    state: featureFlagRuntimeStateSchema,
    critical: z.boolean(),
    cached: z.boolean().optional(),
    default: z.boolean(),
    expected: z.boolean(),
    errorCode: z.enum(["FLAG_NOT_FOUND", "GENERAL"]).optional(),
  })
  .strict();

export const featureFlagEvaluationFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    context: z
      .object({
        targetingKey: z.string().min(1),
        personProperties: z.record(z.string(), z.unknown()),
        groups: z.record(z.string(), z.string()),
        groupProperties: z.record(
          z.string(),
          z.record(z.string(), z.unknown()),
        ),
      })
      .strict(),
    evaluations: z.array(evaluationSchema).min(1),
    safeDefaults: z.array(safeDefaultSchema).min(1),
  })
  .strict();

export type FeatureFlagEvaluationFixture = z.infer<
  typeof featureFlagEvaluationFixtureSchema
>;

export function parseFeatureFlagEvaluationFixture(
  value: unknown,
): FeatureFlagEvaluationFixture {
  const result = featureFlagEvaluationFixtureSchema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => {
      const field = issue.path.map(String).join(".") || "fixture";
      return `${field}: ${issue.message}`;
    })
    .join("; ");
  throw new Error(`Invalid feature flag evaluation fixture: ${details}`);
}

export async function loadFeatureFlagContract(
  repositoryRoot: string,
): Promise<FeatureFlagContract> {
  const source = await readFile(path.join(repositoryRoot, CONTRACT_PATH), "utf8");
  return parseFeatureFlagContract(parse(source));
}

export async function loadFeatureFlagEvaluationFixture(
  repositoryRoot: string,
  contract: FeatureFlagContract,
): Promise<FeatureFlagEvaluationFixture> {
  const source = await readFile(
    path.join(repositoryRoot, PROJECT_DIRECTORY, contract.testing.fixture),
    "utf8",
  );
  return parseFeatureFlagEvaluationFixture(JSON.parse(source));
}

function validateProviderMatrix(contract: FeatureFlagContract): string[] {
  const issues: string[] = [];
  const expected: Record<
    FeatureFlagRuntime,
    { package: string; provider: string; backingSdk: string }
  > = {
    "browser-javascript": {
      package: "@posthog/openfeature-web-provider",
      provider: "PostHogWebProvider",
      backingSdk: "posthog-js",
    },
    nodejs: {
      package: "@posthog/openfeature-node-provider",
      provider: "PostHogServerProvider",
      backingSdk: "posthog-node",
    },
    python: {
      package: "openfeature-provider-posthog",
      provider: "PostHogProvider",
      backingSdk: "posthog",
    },
    "cloudflare-worker": {
      package: "@posthog/openfeature-node-provider",
      provider: "PostHogServerProvider",
      backingSdk: "posthog-node",
    },
  };
  const actual = {
    "browser-javascript": contract.providers.browser_javascript,
    nodejs: contract.providers.nodejs,
    python: contract.providers.python,
    "cloudflare-worker": contract.providers.cloudflare_worker,
  };

  for (const runtime of featureFlagRuntimeSchema.options) {
    const provider = actual[runtime];
    const expectedProvider = expected[runtime];
    if (
      provider.package !== expectedProvider.package ||
      provider.provider !== expectedProvider.provider ||
      provider.backing_sdk !== expectedProvider.backingSdk
    ) {
      issues.push(`${runtime}: provider is not the official PostHog provider`);
    }
  }
  return issues;
}

function validateFixture(
  contract: FeatureFlagContract,
  fixture: FeatureFlagEvaluationFixture,
): string[] {
  const issues: string[] = [];
  const evaluationTypes = fixture.evaluations.map(({ type }) => type);
  if (!setsEqual(evaluationTypes, contract.values.supported)) {
    issues.push("Evaluation fixtures must cover every supported type exactly once");
  }
  for (const duplicate of duplicateValues(
    fixture.evaluations.map(({ key }) => key),
  )) {
    issues.push(`Duplicate evaluation fixture '${duplicate}'`);
  }
  for (const duplicate of duplicateValues(evaluationTypes)) {
    issues.push(`Duplicate evaluation type '${duplicate}'`);
  }

  const requiredCases = new Set([
    "kill-switch-missing",
    "offline",
    "stale-critical",
    "stale-noncritical",
    "not-ready",
  ]);
  const actualCases = new Set(
    fixture.safeDefaults.map((testCase) => testCase.case),
  );
  if (!setsEqual(requiredCases, actualCases)) {
    issues.push("Safe-default fixtures must cover missing, offline, stale, and not-ready states");
  }
  for (const testCase of fixture.safeDefaults) {
    const expected =
      testCase.state === "ready" ||
      (testCase.state === "stale" && !testCase.critical)
        ? (testCase.cached ?? testCase.default)
        : testCase.default;
    if (expected !== testCase.expected) {
      issues.push(`${testCase.case}: expected value violates the state policy`);
    }
  }

  if (
    !setsEqual(
      contract.testing.required_runtimes,
      featureFlagRuntimeSchema.options,
    )
  ) {
    issues.push("Contract must require every supported runtime exactly once");
  }
  return issues;
}

async function validatePinnedDependencies(
  repositoryRoot: string,
  contract: FeatureFlagContract,
): Promise<string[]> {
  const issues: string[] = [];
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, TYPESCRIPT_PACKAGE_PATH), "utf8"),
  ) as { devDependencies?: Record<string, string> };
  const dependencies = packageJson.devDependencies ?? {};
  const expectedNodeDependencies = new Map([
    [
      contract.providers.browser_javascript.package,
      contract.providers.browser_javascript.tested_version,
    ],
    [
      contract.providers.browser_javascript.backing_sdk,
      contract.providers.browser_javascript.backing_sdk_tested_version,
    ],
    [
      contract.providers.nodejs.package,
      contract.providers.nodejs.tested_version,
    ],
    [
      contract.providers.nodejs.backing_sdk,
      contract.providers.nodejs.backing_sdk_tested_version,
    ],
  ]);
  for (const [name, version] of expectedNodeDependencies) {
    if (dependencies[name] !== version) {
      issues.push(`${name}: expected pinned test dependency ${version}`);
    }
  }

  const pythonProject = await readFile(
    path.join(repositoryRoot, PYTHON_PROJECT_PATH),
    "utf8",
  );
  for (const [name, version] of [
    [
      contract.providers.python.package,
      contract.providers.python.tested_version,
    ],
    [
      contract.providers.python.backing_sdk,
      contract.providers.python.backing_sdk_tested_version,
    ],
  ]) {
    if (!pythonProject.includes(`"${name}==${version}"`)) {
      issues.push(`${name}: expected pinned Python test dependency ${version}`);
    }
  }

  const workerConfig = await readFile(
    path.join(repositoryRoot, WORKER_CONFIG_PATH),
    "utf8",
  );
  if (!workerConfig.includes('compatibility_flags = ["nodejs_compat"]')) {
    issues.push("Cloudflare Worker proof must enable nodejs_compat");
  }
  return issues;
}

export async function validateFeatureFlagConformance(
  repositoryRoot: string,
  contract: FeatureFlagContract,
  fixture: FeatureFlagEvaluationFixture,
): Promise<string[]> {
  return [
    ...validateProviderMatrix(contract),
    ...validateFixture(contract, fixture),
    ...(await validatePinnedDependencies(repositoryRoot, contract)),
  ];
}

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const contract = await loadFeatureFlagContract(repositoryRoot);
  const fixture = await loadFeatureFlagEvaluationFixture(
    repositoryRoot,
    contract,
  );
  const issues = await validateFeatureFlagConformance(
    repositoryRoot,
    contract,
    fixture,
  );
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
  console.log(
    `Feature flag contract is valid for ${contract.testing.required_runtimes.length} runtimes and ${fixture.evaluations.length} value types.`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
