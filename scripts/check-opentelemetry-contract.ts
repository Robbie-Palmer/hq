import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type OpenTelemetryContract,
  openTelemetryProhibitedContentClassSchema,
  openTelemetryRuntimeSchema as runtimeSchema,
  openTelemetrySecurityEnforcementSurfaceSchema,
  openTelemetryTransportSchema as transportSchema,
  parseOpenTelemetryContract as parseSharedOpenTelemetryContract,
} from "platform-contracts/opentelemetry";
import { duplicateValues, setsEqual } from "ts-base/collections";
import { errorMessage } from "ts-base/errors";
import { compareStrings } from "ts-base/strings";
import { parse } from "yaml";
import { z } from "zod";

const PROJECT_DIRECTORY =
  "ui/content/projects/personal-engineering-platform";
const CONTRACT_PATH = `${PROJECT_DIRECTORY}/opentelemetry-contract.yaml`;
const FIXTURE_DIRECTORY = `${PROJECT_DIRECTORY}/opentelemetry-conformance`;

const fixtureSchema = z
  .object({
    schema_version: z.literal(1),
    fixture: runtimeSchema,
    runtime: runtimeSchema,
    resource: z.record(z.string(), z.string()),
    instance_strategy: z.enum(["addressable-runtime", "opaque-runtime"]),
    signals: z.array(z.string()).min(1),
    profiles_enabled: z.literal(false),
    propagators: z.array(z.string()).min(1),
    transport: transportSchema,
    semantic_domains: z.array(z.string()).min(1),
    sampling: z
      .object({ sampler: z.string(), ratio: z.number().min(0).max(1) })
      .strict(),
    batching: z
      .object({
        max_queue_size: z.number().int().positive(),
        max_export_batch_size: z.number().int().positive(),
        schedule_delay_ms: z.number().int().positive(),
        export_timeout_ms: z.number().int().positive(),
      })
      .strict(),
    cardinality: z
      .object({
        max_active_instances: z.number().int().positive(),
        max_metric_series_per_instrument: z.number().int().positive(),
        max_span_name_templates: z.number().int().positive(),
      })
      .strict(),
    attribute_allowlist: z
      .object({
        span_and_log_attributes: z.array(z.string()),
        metric_dimensions: z.array(z.string()),
      })
      .strict(),
    assertions: z.array(z.string()).min(1),
  })
  .strict();

export type { OpenTelemetryContract };
export type OpenTelemetryFixture = z.infer<typeof fixtureSchema>;

function parseWithSchema<T>(
  value: unknown,
  schema: z.ZodType<T>,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const field = issue.path.map(String).join(".") || label;
        return `${field}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Invalid ${label}: ${details}`);
  }
  return result.data;
}

export function parseOpenTelemetryContract(
  value: unknown,
): OpenTelemetryContract {
  return parseSharedOpenTelemetryContract(value);
}

export function parseOpenTelemetryFixture(
  value: unknown,
): OpenTelemetryFixture {
  return parseWithSchema(value, fixtureSchema, "OpenTelemetry fixture");
}

export async function loadOpenTelemetryContract(
  repositoryRoot: string,
): Promise<OpenTelemetryContract> {
  const source = await readFile(path.join(repositoryRoot, CONTRACT_PATH), "utf8");
  return parseOpenTelemetryContract(parse(source));
}

export async function loadOpenTelemetryFixtures(
  repositoryRoot: string,
): Promise<OpenTelemetryFixture[]> {
  const fixtureDirectory = path.join(repositoryRoot, FIXTURE_DIRECTORY);
  const fixtureFiles = (await readdir(fixtureDirectory))
    .filter((file) => file.endsWith(".yaml"))
    .sort(compareStrings);
  return Promise.all(
    fixtureFiles.map(async (fixtureFile) => {
      const source = await readFile(path.join(fixtureDirectory, fixtureFile), "utf8");
      return parseOpenTelemetryFixture(parse(source));
    }),
  );
}

function validateIdentity(
  contract: OpenTelemetryContract,
  fixture: OpenTelemetryFixture,
): string[] {
  const issues: string[] = [];
  for (const attribute of contract.resource_identity.required) {
    if (!fixture.resource[attribute]) {
      issues.push(`${fixture.fixture}: missing resource attribute '${attribute}'`);
    }
  }

  const instanceAttribute = contract.resource_identity.instance.attribute;
  const instanceId = fixture.resource[instanceAttribute];
  if (fixture.instance_strategy === "addressable-runtime" && !instanceId) {
    issues.push(`${fixture.fixture}: addressable runtime needs '${instanceAttribute}'`);
  }
  if (fixture.instance_strategy === "opaque-runtime" && instanceId) {
    issues.push(`${fixture.fixture}: opaque runtime must omit '${instanceAttribute}'`);
  }

  const workspaceAttribute = contract.resource_identity.workspace.attribute;
  if (fixture.runtime === "agent-workspace" && !fixture.resource[workspaceAttribute]) {
    issues.push(`${fixture.fixture}: agent workspace needs '${workspaceAttribute}'`);
  }
  return issues;
}

function validateProcessing(
  contract: OpenTelemetryContract,
  fixture: OpenTelemetryFixture,
): string[] {
  const issues: string[] = [];
  const expectedRatio =
    fixture.resource["deployment.environment.name"] === "production"
      ? contract.processing.sampling.production_ratio
      : contract.processing.sampling.development_ratio;
  if (
    fixture.sampling.sampler !== contract.processing.sampling.sampler ||
    fixture.sampling.ratio !== expectedRatio
  ) {
    issues.push(`${fixture.fixture}: sampling must use the environment default`);
  }
  if (
    fixture.batching.max_export_batch_size > fixture.batching.max_queue_size ||
    fixture.batching.max_queue_size > contract.processing.batching.max_queue_size ||
    fixture.batching.max_export_batch_size >
      contract.processing.batching.max_export_batch_size ||
    fixture.batching.schedule_delay_ms >
      contract.processing.batching.schedule_delay_ms ||
    fixture.batching.export_timeout_ms >
      contract.processing.batching.export_timeout_ms
  ) {
    issues.push(`${fixture.fixture}: batching exceeds the contract bounds`);
  }
  return issues;
}

function validateCardinality(
  contract: OpenTelemetryContract,
  fixture: OpenTelemetryFixture,
): string[] {
  const issues: string[] = [];
  if (
    fixture.cardinality.max_metric_series_per_instrument >
    contract.cardinality.max_metric_series_per_instrument
  ) {
    issues.push(`${fixture.fixture}: metric series budget exceeds the contract`);
  }
  if (
    fixture.cardinality.max_span_name_templates >
    contract.cardinality.max_span_name_templates_per_service
  ) {
    issues.push(`${fixture.fixture}: span-name budget exceeds the contract`);
  }

  const forbidden = new Set(contract.cardinality.forbidden_metric_attributes);
  for (const attribute of fixture.attribute_allowlist.metric_dimensions) {
    if (forbidden.has(attribute)) {
      issues.push(`${fixture.fixture}: allows forbidden metric attribute '${attribute}'`);
    }
  }
  return issues;
}

function validateFixtureContractFields(
  contract: OpenTelemetryContract,
  fixture: OpenTelemetryFixture,
): string[] {
  const issues: string[] = [];
  if (fixture.fixture !== fixture.runtime) {
    issues.push(`${fixture.fixture}: fixture ID must match runtime`);
  }
  if (!setsEqual(fixture.signals, contract.signals.required)) {
    issues.push(`${fixture.fixture}: signals do not match the contract`);
  }
  if (!setsEqual(fixture.propagators, contract.propagation.propagators)) {
    issues.push(`${fixture.fixture}: propagators do not match the contract`);
  }
  const expectedTransport = contract.transport.runtime_defaults[fixture.runtime];
  if (
    fixture.transport.protocol !== expectedTransport?.protocol ||
    fixture.transport.route !== expectedTransport?.route
  ) {
    issues.push(`${fixture.fixture}: transport does not match its runtime default`);
  }
  return issues;
}

function validateSemanticDomains(
  contract: OpenTelemetryContract,
  fixture: OpenTelemetryFixture,
): string[] {
  const issues: string[] = [];
  const knownDomains = new Set(contract.semantic_conventions.domains);
  for (const domain of fixture.semantic_domains) {
    if (!knownDomains.has(domain)) {
      issues.push(`${fixture.fixture}: unknown semantic domain '${domain}'`);
    }
  }
  for (const duplicate of duplicateValues(fixture.semantic_domains)) {
    issues.push(`${fixture.fixture}: duplicate semantic domain '${duplicate}'`);
  }
  return issues;
}

function validateContractAttributePolicy(
  contract: OpenTelemetryContract,
): string[] {
  const issues: string[] = [];
  const { exact, prefixes } = contract.data_policy.prohibited_attribute_keys;
  for (const duplicate of duplicateValues(exact)) {
    issues.push(`Duplicate prohibited attribute key '${duplicate}'`);
  }
  for (const duplicate of duplicateValues(prefixes)) {
    issues.push(`Duplicate prohibited attribute prefix '${duplicate}'`);
  }
  for (const prefix of prefixes) {
    if (!prefix.endsWith(".")) {
      issues.push(`Prohibited attribute prefix '${prefix}' must end with '.'`);
    }
  }
  for (const duplicate of duplicateValues(
    contract.data_policy.prohibited_content_classes,
  )) {
    issues.push(`Duplicate prohibited content class '${duplicate}'`);
  }
  if (
    !setsEqual(
      contract.data_policy.prohibited_content_classes,
      openTelemetryProhibitedContentClassSchema.options,
    )
  ) {
    issues.push("Data policy must prohibit every security content class");
  }
  for (const duplicate of duplicateValues(
    contract.data_policy.enforcement_surfaces,
  )) {
    issues.push(`Duplicate security enforcement surface '${duplicate}'`);
  }
  if (
    !setsEqual(
      contract.data_policy.enforcement_surfaces,
      openTelemetrySecurityEnforcementSurfaceSchema.options,
    )
  ) {
    issues.push("Data policy must cover every security enforcement surface");
  }
  for (const duplicate of duplicateValues(
    contract.cardinality.forbidden_metric_attributes,
  )) {
    issues.push(`Duplicate forbidden metric attribute '${duplicate}'`);
  }
  return issues;
}

function validateAttributePolicy(
  contract: OpenTelemetryContract,
  fixture: OpenTelemetryFixture,
): string[] {
  const issues: string[] = [];
  const exact = new Set(contract.data_policy.prohibited_attribute_keys.exact);
  const prefixes = contract.data_policy.prohibited_attribute_keys.prefixes;
  const scopes = ["span_and_log_attributes", "metric_dimensions"] as const;

  for (const scope of scopes) {
    const attributes = fixture.attribute_allowlist[scope];
    for (const duplicate of duplicateValues(attributes)) {
      issues.push(`${fixture.fixture}: duplicate ${scope} entry '${duplicate}'`);
    }
    for (const attribute of attributes) {
      if (
        exact.has(attribute) ||
        prefixes.some((prefix) => attribute.startsWith(prefix))
      ) {
        issues.push(
          `${fixture.fixture}: ${scope} allowlist includes prohibited attribute '${attribute}'`,
        );
      }
    }
  }
  return issues;
}

function validateFixture(
  contract: OpenTelemetryContract,
  fixture: OpenTelemetryFixture,
): string[] {
  return [
    ...validateFixtureContractFields(contract, fixture),
    ...validateSemanticDomains(contract, fixture),
    ...validateAttributePolicy(contract, fixture),
    ...validateIdentity(contract, fixture),
    ...validateProcessing(contract, fixture),
    ...validateCardinality(contract, fixture),
  ];
}

export function validateOpenTelemetryConformance(
  contract: OpenTelemetryContract,
  fixtures: OpenTelemetryFixture[],
): string[] {
  const issues = validateContractAttributePolicy(contract);
  const runtimes = fixtures.map(({ runtime }) => runtime);
  if (!setsEqual(runtimes, contract.conformance.required_runtimes)) {
    issues.push("Fixtures must cover each required runtime exactly once");
  }
  for (const duplicate of duplicateValues(runtimes)) {
    issues.push(`Duplicate conformance fixture for '${duplicate}'`);
  }

  for (const fixture of fixtures) {
    issues.push(...validateFixture(contract, fixture));
  }
  return issues.sort(compareStrings);
}

/* v8 ignore start -- The mise check exercises this CLI wrapper. */
async function main(): Promise<void> {
  try {
    const repositoryRoot = process.cwd();
    const [contract, fixtures] = await Promise.all([
      loadOpenTelemetryContract(repositoryRoot),
      loadOpenTelemetryFixtures(repositoryRoot),
    ]);
    const issues = validateOpenTelemetryConformance(contract, fixtures);
    if (issues.length > 0) {
      for (const issue of issues) console.error(`opentelemetry: ${issue}`);
      process.exitCode = 1;
      return;
    }
    console.log("OpenTelemetry contract and conformance fixtures are valid.");
  } catch (error) {
    console.error(
      `opentelemetry: ${errorMessage(error, "Contract validation failed")}`,
    );
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
/* v8 ignore stop */
