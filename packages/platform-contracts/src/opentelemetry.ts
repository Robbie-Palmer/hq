import { z } from "zod";
import { parseContract } from "./parse";

export const openTelemetryRuntimeSchema = z.enum([
  "typescript-worker",
  "python-service",
  "kubernetes-workload",
  "agent-workspace",
]);

const protocolSchema = z.enum(["http/protobuf", "grpc"]);
const routeSchema = z.enum(["direct", "collector"]);

export const openTelemetryProhibitedContentClassSchema = z.enum([
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

export const openTelemetrySecurityEnforcementSurfaceSchema = z.enum([
  "resource-attributes",
  "span-attributes",
  "span-events",
  "log-attributes",
  "log-body",
  "metric-attributes",
  "baggage",
]);

export const openTelemetryTransportSchema = z
  .object({ protocol: protocolSchema, route: routeSchema })
  .strict();

export const openTelemetryContractSchema = z
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
        runtime_defaults: z.record(
          openTelemetryRuntimeSchema,
          openTelemetryTransportSchema,
        ),
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
        enforcement_surfaces: z
          .array(openTelemetrySecurityEnforcementSurfaceSchema)
          .min(1),
        prohibited_attribute_keys: z
          .object({
            exact: z.array(z.string()).min(1),
            prefixes: z.array(z.string()).min(1),
          })
          .strict(),
        prohibited_content_classes: z
          .array(openTelemetryProhibitedContentClassSchema)
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
        required_runtimes: z.array(openTelemetryRuntimeSchema),
      })
      .strict(),
  })
  .strict();

export type OpenTelemetryContract = z.infer<
  typeof openTelemetryContractSchema
>;
export type OpenTelemetryRuntime = z.infer<typeof openTelemetryRuntimeSchema>;

export function parseOpenTelemetryContract(
  value: unknown,
): OpenTelemetryContract {
  return parseContract(
    value,
    openTelemetryContractSchema,
    "OpenTelemetry contract",
  );
}
