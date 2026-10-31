import { createHash } from "node:crypto";

import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { z } from "zod";

import { findDuplicates, IdentifierSchema } from "./vocabulary";

const CedarFileNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*\.(?:cedar|json)$/);
const CedarEntityTypeSchema = z
  .string()
  .regex(/^AgentCoordinator::[A-Za-z]\w*$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const CONTROLLER_CEDAR_POLICY_FILES = [
  "controller-admission.cedar",
  "github.cedar",
  "t3.cedar",
  "work-graph.cedar",
  "deployment.cedar",
] as const;

export const ControllerCedarActionSchema = z.enum([
  "controller.incident.admit",
  "github.contents.write",
  "github.git_refs.write",
  "github.pull_requests.create",
  "github.pull_requests.review_comments.write",
  "github.pull_requests.merge",
  "github.dependabot_alerts.dismiss",
  "github.repository_rules.write",
  "github.actions_workflows.write",
  "t3.worker.launch",
  "t3.pull_request.watch",
  "work_graph.incident.write",
  "work_graph.incident.complete",
  "work_graph.attention.request",
  "deployment.production.invoke",
  "deployment.production.validate",
  "deployment.production.repair",
  "deployment.path.create",
]);
export type ControllerCedarAction = z.infer<typeof ControllerCedarActionSchema>;

export const CedarBundleManifestSchema = z
  .object({
    schemaFile: z.literal("controller.cedarschema.json"),
    policyFiles: z.array(CedarFileNameSchema).length(CONTROLLER_CEDAR_POLICY_FILES.length),
    sha256: Sha256Schema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const duplicates = findDuplicates(manifest.policyFiles);
    if (duplicates.length > 0) {
      context.addIssue({
        code: "custom",
        message: `policyFiles contains duplicate values: ${duplicates.join(", ")}`,
        path: ["policyFiles"],
      });
    }
    if (
      JSON.stringify(manifest.policyFiles) !==
      JSON.stringify(CONTROLLER_CEDAR_POLICY_FILES)
    ) {
      context.addIssue({
        code: "custom",
        message: "policyFiles must name the reviewed controller policy modules in order",
        path: ["policyFiles"],
      });
    }
  });
export type CedarBundleManifest = z.infer<typeof CedarBundleManifestSchema>;

export const CedarAuthorizationPolicySchema = z
  .object({
    engine: z.literal("cedar"),
    principal: z
      .object({
        type: z.literal("AgentCoordinator::Controller"),
        id: IdentifierSchema,
      })
      .strict(),
    bundle: CedarBundleManifestSchema,
  })
  .strict();
export type CedarAuthorizationPolicy = z.infer<
  typeof CedarAuthorizationPolicySchema
>;

type CedarInputValue =
  | boolean
  | number
  | string
  | null
  | CedarInputValue[]
  | { [key: string]: CedarInputValue };

const CedarInputValueSchema: z.ZodType<CedarInputValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.int(),
    z.string(),
    z.null(),
    z.array(CedarInputValueSchema),
    z.record(z.string(), CedarInputValueSchema),
  ]),
);

const CedarEntityUidSchema = z
  .object({
    type: CedarEntityTypeSchema,
    id: z.string().min(1),
  })
  .strict();

export const ControllerCedarEntitySchema = z
  .object({
    uid: CedarEntityUidSchema,
    attrs: z.record(z.string(), CedarInputValueSchema),
    parents: z.array(CedarEntityUidSchema).default([]),
  })
  .strict();
export type ControllerCedarEntity = z.infer<
  typeof ControllerCedarEntitySchema
>;

export const ControllerAuthorizationRequestSchema = z
  .object({
    action: ControllerCedarActionSchema,
    authorityProfileId: IdentifierSchema,
    resource: ControllerCedarEntitySchema,
    supportingEntities: z.array(ControllerCedarEntitySchema).default([]),
    context: z.record(z.string(), CedarInputValueSchema).default({}),
    providerCapability: z
      .object({
        granted: z.boolean(),
        source: IdentifierSchema,
      })
      .strict(),
  })
  .strict();
export type ControllerAuthorizationRequest = z.infer<
  typeof ControllerAuthorizationRequestSchema
>;

export type ControllerAuthorizationDecision =
  | {
      decision: "allow";
      determiningPolicies: string[];
    }
  | {
      decision: "deny";
      reason:
        | "cedar-evaluation-error"
        | "cedar-policy-deny"
        | "provider-capability-deny";
      diagnostics: string[];
    };

export type ControllerCedarBundleFiles = Record<string, string>;

function bundlePayload(
  manifest: Pick<CedarBundleManifest, "schemaFile" | "policyFiles">,
  files: ControllerCedarBundleFiles,
): string {
  const requiredFiles = [manifest.schemaFile, ...manifest.policyFiles];
  const missingFiles = requiredFiles.filter((fileName) => files[fileName] === undefined);
  if (missingFiles.length > 0) {
    throw new Error(`Cedar bundle is missing files: ${missingFiles.join(", ")}`);
  }
  return JSON.stringify(
    requiredFiles.map((fileName) => ({
      fileName,
      contents: files[fileName],
    })),
  );
}

export function computeCedarBundleSha256(
  manifest: Pick<CedarBundleManifest, "schemaFile" | "policyFiles">,
  files: ControllerCedarBundleFiles,
): string {
  return createHash("sha256").update(bundlePayload(manifest, files)).digest("hex");
}

function formatCedarErrors(
  errors: Array<{ message: string }> | Array<{ error: { message: string }; policyId: string }>,
): string[] {
  return errors.map((candidate) =>
    "error" in candidate
      ? `${candidate.policyId}: ${candidate.error.message}`
      : candidate.message,
  );
}

function cedarEvaluationError(diagnostics: string[]): ControllerAuthorizationDecision {
  return {
    decision: "deny",
    reason: "cedar-evaluation-error",
    diagnostics,
  };
}

function decisionFromCedarAnswer(
  answer: cedar.AuthorizationAnswer,
): ControllerAuthorizationDecision {
  if (answer.type === "failure") {
    return cedarEvaluationError(formatCedarErrors(answer.errors));
  }
  const evaluationErrors = formatCedarErrors(answer.response.diagnostics.errors);
  if (evaluationErrors.length > 0 || answer.warnings.length > 0) {
    return cedarEvaluationError([
      ...evaluationErrors,
      ...formatCedarErrors(answer.warnings),
    ]);
  }
  if (answer.response.decision === "deny") {
    return {
      decision: "deny",
      reason: "cedar-policy-deny",
      diagnostics: answer.response.diagnostics.reason,
    };
  }
  return {
    decision: "allow",
    determiningPolicies: answer.response.diagnostics.reason,
  };
}

export interface ControllerAuthorizer {
  authorize(requestInput: ControllerAuthorizationRequest): ControllerAuthorizationDecision;
}

export function createControllerAuthorizer(
  policyInput: CedarAuthorizationPolicy,
  files: ControllerCedarBundleFiles,
  policyRevision: number,
): ControllerAuthorizer {
  const policy = CedarAuthorizationPolicySchema.parse(policyInput);
  const revision = z.number().int().positive().parse(policyRevision);
  const expectedSha256 = computeCedarBundleSha256(policy.bundle, files);
  if (expectedSha256 !== policy.bundle.sha256) {
    throw new Error(
      `Cedar bundle digest mismatch: expected ${policy.bundle.sha256}, computed ${expectedSha256}`,
    );
  }

  const schemaText = files[policy.bundle.schemaFile];
  if (schemaText === undefined) {
    throw new Error(`Cedar schema file is missing: ${policy.bundle.schemaFile}`);
  }
  let schema: cedar.Schema;
  try {
    schema = JSON.parse(schemaText) as cedar.Schema;
  } catch (error) {
    throw new Error("Cedar schema is not valid JSON", { cause: error });
  }
  const policyText = policy.bundle.policyFiles
    .map((fileName) => files[fileName])
    .join("\n");
  const policyParts = cedar.policySetTextToParts(policyText);
  if (policyParts.type === "failure") {
    throw new Error(
      `Cedar bundle parse failure: ${formatCedarErrors(policyParts.errors).join("; ")}`,
    );
  }
  if (policyParts.policy_templates.length > 0) {
    throw new Error("Cedar controller bundle cannot contain policy templates");
  }
  const staticPolicies: Record<string, string> = {};
  for (const policyPart of policyParts.policies) {
    const parsedPolicy = cedar.policyToJson(policyPart);
    if (parsedPolicy.type === "failure") {
      throw new Error(
        `Cedar policy parse failure: ${formatCedarErrors(parsedPolicy.errors).join("; ")}`,
      );
    }
    const policyId = parsedPolicy.json.annotations?.id;
    if (policyId === undefined || policyId.length === 0) {
      throw new Error("Every Cedar controller policy must have a non-empty @id annotation");
    }
    if (staticPolicies[policyId] !== undefined) {
      throw new Error(`Duplicate Cedar controller policy id: ${policyId}`);
    }
    staticPolicies[policyId] = policyPart;
  }
  const validation = cedar.validate({
    schema,
    policies: { staticPolicies },
    validationSettings: { mode: "strict" },
  });
  if (validation.type === "failure") {
    throw new Error(
      `Cedar bundle parse failure: ${formatCedarErrors(validation.errors).join("; ")}`,
    );
  }
  const validationDiagnostics = [
    ...formatCedarErrors(validation.validationErrors),
    ...formatCedarErrors(validation.validationWarnings),
    ...formatCedarErrors(validation.otherWarnings),
  ];
  if (validationDiagnostics.length > 0) {
    throw new Error(
      `Cedar bundle validation diagnostics: ${validationDiagnostics.join("; ")}`,
    );
  }

  return {
    authorize(requestInput) {
      const parsedRequest = ControllerAuthorizationRequestSchema.safeParse(requestInput);
      if (!parsedRequest.success) {
        return cedarEvaluationError(
          parsedRequest.error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`,
          ),
        );
      }
      const request = parsedRequest.data;
      if (!request.providerCapability.granted) {
        return {
          decision: "deny",
          reason: "provider-capability-deny",
          diagnostics: [request.providerCapability.source],
        };
      }

      const principal = policy.principal;
      const controllerEntity: cedar.EntityJson = {
        uid: principal,
        attrs: {
          bundleSha256: policy.bundle.sha256,
          policyRevision: revision,
        },
        parents: [
          {
            type: "AgentCoordinator::AuthorityProfile",
            id: request.authorityProfileId,
          },
        ],
      };
      let answer: cedar.AuthorizationAnswer;
      try {
        answer = cedar.isAuthorized({
          principal,
          action: {
            type: "AgentCoordinator::Action",
            id: request.action,
          },
          resource: request.resource.uid,
          context: request.context,
          schema,
          validateRequest: true,
          policies: { staticPolicies },
          entities: [
            controllerEntity,
            request.resource as cedar.EntityJson,
            ...(request.supportingEntities as cedar.EntityJson[]),
          ],
        });
      } catch (error) {
        return cedarEvaluationError([
          error instanceof Error ? error.message : String(error),
        ]);
      }
      return decisionFromCedarAnswer(answer);
    },
  };
}
