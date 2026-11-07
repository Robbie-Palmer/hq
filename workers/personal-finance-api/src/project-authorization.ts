import * as cedar from "@cedar-policy/cedar-wasm";
import { compileCedarPolicySet } from "cedar-authorization";
import { z } from "zod";

import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  AuthorizationRequest,
} from "./authorization";
import schemaDocument from "./project-authorization.cedarschema.json";
import { PROJECT_AUTHORIZATION_POLICY } from "./project-authorization-policy";

export const ProjectAuthorizationActionSchema = z.enum([
  "household.create",
  "household.read",
  "household.delete",
]);

const ProjectAuthorizationRequestSchema = z
  .object({
    action: ProjectAuthorizationActionSchema,
    resource: z
      .object({
        type: z.literal("household"),
        id: z.string().trim().min(1),
        ownerUserId: z.string().trim().min(1),
        syntheticOnly: z.boolean(),
      })
      .strict(),
  })
  .strict();

function evaluationError(diagnostics: string[]): AuthorizationDecision {
  return { allowed: false, reason: "evaluation-error", diagnostics };
}

export function createProjectAuthorization(
  candidatePolicyText: string,
  candidateSchema: cedar.Schema,
): AuthorizationPolicy {
  const policySet = compileCedarPolicySet({
    engine: cedar,
    label: "Personal Finance",
    policies: candidatePolicyText,
    schema: candidateSchema,
  });

  return (session, requestInput) => {
    const parsedRequest = ProjectAuthorizationRequestSchema.safeParse(requestInput);
    if (!parsedRequest.success) {
      return evaluationError(
        parsedRequest.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      );
    }
    const request = parsedRequest.data;
    try {
      const answer = policySet.authorize({
        principal: {
          type: "PersonalFinance::User",
          id: session.user.id,
        },
        action: {
          type: "PersonalFinance::Action",
          id: request.action,
        },
        resource: {
          type: "PersonalFinance::Household",
          id: request.resource.id,
        },
        context: {},
        schema: candidateSchema,
        validateRequest: true,
        entities: [
          {
            uid: {
              type: "PersonalFinance::User",
              id: session.user.id,
            },
            attrs: { userId: session.user.id },
            parents: [],
          },
          {
            uid: {
              type: "PersonalFinance::Household",
              id: request.resource.id,
            },
            attrs: {
              ownerUserId: request.resource.ownerUserId,
              syntheticOnly: request.resource.syntheticOnly,
            },
            parents: [],
          },
        ],
      });
      if (answer.decision === "allow") {
        return {
          allowed: true,
          determiningPolicies: answer.determiningPolicies,
        };
      }
      return {
        allowed: false,
        reason:
          answer.reason === "cedar-policy-deny"
            ? "policy-deny"
            : "evaluation-error",
        diagnostics: answer.diagnostics,
      };
    } catch (error) {
      return evaluationError([
        error instanceof Error ? error.message : String(error),
      ]);
    }
  };
}

export function householdAuthorizationRequest(
  action: "household.create" | "household.read",
  ownerUserId: string,
): AuthorizationRequest {
  return {
    action,
    resource: {
      type: "household",
      id: `household-canary:${ownerUserId}`,
      ownerUserId,
      syntheticOnly: true,
    },
  };
}

export const projectAuthorization = createProjectAuthorization(
  PROJECT_AUTHORIZATION_POLICY,
  schemaDocument as cedar.Schema,
);
