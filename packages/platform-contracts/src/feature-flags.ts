import { z } from "zod";
import { parseContract } from "./parse";

export const featureFlagRuntimeSchema = z.enum([
  "browser-javascript",
  "nodejs",
  "python",
  "cloudflare-worker",
]);

export const featureFlagValueTypeSchema = z.enum([
  "boolean",
  "string",
  "number",
  "object",
]);

export const featureFlagRuntimeStateSchema = z.enum([
  "not-ready",
  "ready",
  "stale",
  "error",
]);

const providerSchema = z
  .object({
    package: z.string().min(1),
    tested_version: z.string().min(1),
    provider: z.string().min(1),
    backing_sdk: z.string().min(1),
    backing_sdk_tested_version: z.string().min(1),
  })
  .strict();

const stateActionSchema = z.enum(["evaluate", "cached-or-default", "default"]);

export const featureFlagContractSchema = z
  .object({
    schema_version: z.literal(1),
    contract: z.literal("feature-flags"),
    api: z
      .object({
        standard: z.literal("OpenFeature"),
        control_plane: z.literal("PostHog"),
        analytics_boundary: z.literal("native-posthog-sdk"),
      })
      .strict(),
    context: z
      .object({
        targeting_key: z
          .object({
            server: z.literal("required"),
            browser: z.literal("native-sdk-identity"),
          })
          .strict(),
        groups_attribute: z.literal("groups"),
        group_properties_attributes: z
          .object({
            javascript: z.literal("groupProperties"),
            python: z.literal("group_properties"),
          })
          .strict(),
        person_properties: z.literal("all-unreserved-attributes"),
      })
      .strict(),
    values: z
      .object({
        supported: z.array(featureFlagValueTypeSchema).length(4),
        payload: z.literal("json-object-or-array"),
        number_source: z.literal("variant-key"),
        safe_default_required: z.literal(true),
      })
      .strict(),
    details: z
      .object({
        required: z
          .array(z.enum(["value", "reason", "errorCode", "errorMessage"]))
          .length(4),
        optional: z.array(z.enum(["variant", "flagMetadata"])),
        posthog_reason_location: z.literal("flagMetadata.posthog_reason"),
      })
      .strict(),
    lifecycle: z
      .object({
        initialize_with: z.literal("setProviderAndWait"),
        provider_replacement: z.literal("await-before-use"),
        state_actions: z
          .record(featureFlagRuntimeStateSchema, stateActionSchema)
          .refine(
            (actions) =>
              actions["not-ready"] === "default" &&
              actions.ready === "evaluate" &&
              actions.stale === "cached-or-default" &&
              actions.error === "default",
            "runtime state actions must preserve safe-default behavior",
          ),
        stale_critical_action: z.literal("default"),
        stale_noncritical_action: z.literal("cached-or-default"),
      })
      .strict(),
    exposure: z
      .object({
        owner: z.literal("native-posthog-sdk"),
        event: z.literal("$feature_flag_called"),
        openfeature_capture_hook: z.literal("forbidden"),
        per_logical_evaluation: z.literal("exactly-once"),
        experiments_require_exposure: z.literal(true),
      })
      .strict(),
    credentials: z
      .object({
        browser: z.literal("public-project-token-only"),
        remote_server: z.literal("public-project-token"),
        local_evaluation: z.literal("server-secret-key"),
        secret_in_client_runtime: z.literal(false),
      })
      .strict(),
    evaluation: z
      .object({
        public_client: z.literal("remote"),
        server_default: z.literal("remote"),
        local_evaluation: z.literal("server-only"),
        local_definition_failure: z.literal("remote-or-default"),
        offline: z.literal("default-unless-explicit-stale-cache-policy"),
      })
      .strict(),
    providers: z
      .object({
        browser_javascript: providerSchema,
        nodejs: providerSchema,
        python: providerSchema,
        cloudflare_worker: providerSchema.extend({
          export_condition: z.literal("workerd"),
          compatibility_flag: z.literal("nodejs_compat"),
        }),
      })
      .strict(),
    testing: z
      .object({
        provider: z.literal("deterministic-fake-or-in-memory"),
        production_credentials: z.literal(false),
        live_project_mutation: z.literal(false),
        fixture: z.string().min(1),
        required_runtimes: z.array(featureFlagRuntimeSchema).length(4),
      })
      .strict(),
  })
  .strict();

export type FeatureFlagContract = z.infer<typeof featureFlagContractSchema>;
export type FeatureFlagRuntime = z.infer<typeof featureFlagRuntimeSchema>;
export type FeatureFlagRuntimeState = z.infer<
  typeof featureFlagRuntimeStateSchema
>;
export type FeatureFlagValueType = z.infer<typeof featureFlagValueTypeSchema>;

export function parseFeatureFlagContract(value: unknown): FeatureFlagContract {
  return parseContract(value, featureFlagContractSchema, "feature flag contract");
}
