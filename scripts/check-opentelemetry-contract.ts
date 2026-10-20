import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { duplicateValues, setsEqual } from "ts-base/collections";
import { errorMessage } from "ts-base/errors";
import { compareStrings } from "ts-base/strings";
import { parse } from "yaml";
import { z } from "zod";

const PROJECT_DIRECTORY =
  "ui/content/projects/personal-engineering-platform";
const CONTRACT_PATH = `${PROJECT_DIRECTORY}/opentelemetry-contract.yaml`;
const FIXTURE_DIRECTORY = `${PROJECT_DIRECTORY}/opentelemetry-conformance`;

const runtimeSchema = z.enum([
  "typescript-worker",
  "python-service",
  "kubernetes-workload",
  "agent-workspace",
]);
const protocolSchema = z.enum(["http/protobuf", "grpc"]);
const routeSchema = z.enum(["direct", "collector"]);
const prohibitedContentClassSchema = z.enum([
  "credential",
  "authorization-header",
  "cookie",
  "environment-variable",
  "prompt",
  "model-response",
  "tool-arguments",
  "tool-result",
  "source-content",
  "diff",
  "terminal-output",
  "database-statement",
  "database-bind-value",
  "message-body",
  "user-data-object-key",
  "personal-identifier",
  "raw-url-path",
  "raw-url-query-string",
]);
const securityEnforcementSurfaceSchema = z.enum([
  "resource-attributes",
  "span-attributes",
  "span-events",
  "log-attributes",
  "log-body",
  "metric-attributes",
  "baggage",
]);

const transportSchema = z
  .object({ protocol: protocolSchema, route: routeSchema })
  .strict();

const contractSchema = z
  .object({
    schema_version: z.literal(1),
    contract: z.literal("opentelemetry"),
    signals: z
      .object({
        required: z.array(z.string()).min(1),
        deferred: z.array(z.string()),
      })
      .strict(),
    resource_identity: z
      .object({
        required: z.array(z.string()).min(1),
        instance: z
          .object({
            attribute: z.string(),
            required_when: z.string(),
            opaque_runtime: z.string(),
          })
          .strict(),
        workspace: z
          .object({
            attribute: z.string(),
            required_when: z.string(),
          })
          .strict(),
      })
      .strict(),
    propagation: z
      .object({
        propagators: z.array(z.string()).min(1),
        trust_boundary: z.string(),
        baggage_allowlist: z.array(z.string()),
      })
      .strict(),
    transport: z
      .object({
        default_protocol: protocolSchema,
        runtime_defaults: z.record(runtimeSchema, transportSchema),
        collector_required_when: z.array(z.string()).min(1),
        direct_export_allowed_when: z.array(z.string()).min(1),
      })
      .strict(),
    semantic_conventions: z
      .object({
        policy: z.literal("stable-only"),
        domains: z.array(z.string()).min(1),
        unstable_opt_in: z
          .object({ allowed: z.literal(false), rule: z.string() })
          .strict(),
        custom_namespace: z
          .string()
          .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/),
      })
      .strict(),
    data_policy: z
      .object({
        mode: z.literal("default-deny"),
        enforcement_surfaces: z.array(securityEnforcementSurfaceSchema).min(1),
        prohibited_attribute_keys: z
          .object({
            exact: z.array(z.string()).min(1),
            prefixes: z.array(z.string()).min(1),
          })
          .strict(),
        prohibited_content_classes: z
          .array(prohibitedContentClassSchema)
          .min(1),
        redaction: z.literal("deterministic-only"),
        unsafe_record_action: z.literal("drop"),
      })
      .strict(),
    cardinality: z
      .object({
        max_metric_series_per_instrument: z.number().int().positive(),
        max_attribute_count_per_record: z.number().int().positive(),
        max_attribute_value_length: z.number().int().positive(),
        max_span_name_templates_per_service: z.number().int().positive(),
        metric_attribute_value_classes: z
          .object({
            low: z.number().int().positive(),
            bounded: z.number().int().positive(),
          })
          .strict(),
        forbidden_metric_attributes: z.array(z.string()).min(1),
      })
      .strict(),
    processing: z
      .object({
        sampling: z
          .object({
            sampler: z.string(),
            development_ratio: z.number().min(0).max(1),
            production_ratio: z.number().min(0).max(1),
            project_override_range: z.tuple([
              z.number().min(0).max(1),
              z.number().min(0).max(1),
            ]),
          })
          .strict(),
        batching: z
          .object({
            required: z.literal(true),
            max_queue_size: z.number().int().positive(),
            max_export_batch_size: z.number().int().positive(),
            schedule_delay_ms: z.number().int().positive(),
            export_timeout_ms: z.number().int().positive(),
          })
          .strict(),
        retry: z
          .object({
            transient_only: z.literal(true),
            exponential_backoff: z.literal(true),
            jitter: z.literal(true),
            honor_retry_after: z.literal(true),
            bounded_by_queue: z.literal(true),
          })
          .strict(),
        failure_mode: z.literal("fail-open"),
      })
      .strict(),
    time: z
      .object({
        duration_clock: z.literal("monotonic"),
        timestamp_clock: z.string(),
        max_observed_skew_seconds: z.number().positive(),
        rewrite_timestamps_in_collector: z.literal(false),
      })
      .strict(),
    errors: z
      .object({
        success_span_status: z.literal("unset"),
        failure_span_status: z.literal("error"),
        type_attribute: z.literal("error.type"),
        record_unhandled_exception_once: z.literal(true),
        record_handled_exception_as_error: z.literal(false),
        messages_and_stacks_follow_data_policy: z.literal(true),
      })
      .strict(),
    conformance: z
      .object({
        fixture_directory: z.string(),
        required_runtimes: z.array(runtimeSchema),
      })
      .strict(),
  })
  .strict();

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

export type OpenTelemetryContract = z.infer<typeof contractSchema>;
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
  return parseWithSchema(value, contractSchema, "OpenTelemetry contract");
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
      prohibitedContentClassSchema.options,
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
      securityEnforcementSurfaceSchema.options,
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
