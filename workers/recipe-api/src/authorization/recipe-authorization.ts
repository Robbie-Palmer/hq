import * as cedar from "@cedar-policy/cedar-wasm";
import { compileCedarPolicySet } from "cedar-authorization";
import { z } from "zod";

import schemaJson from "./recipe.cedarschema.json" with { type: "json" };
import { RECIPE_AUTHORIZATION_POLICY } from "./recipe-policy";

export const RecipeAuthorizationActionSchema = z.enum([
  "recipe.read",
  "resource.owner.manage",
  "household.membership.manage",
  "recipes.search",
  "recipes.read",
  "recipes.dataset.inspect",
  "recipe_import.create",
  "recipe_import.status",
  "pantry.read",
  "pantry.reconcile",
  "shopping_list.read",
  "cook_log.read",
  "cook_log.append",
  "cooking_insights.read",
]);
export type RecipeAuthorizationAction = z.infer<
  typeof RecipeAuthorizationActionSchema
>;

export const RECIPE_AGENT_AUTHORIZATION_ACTIONS = [
  "recipes.search",
  "recipes.read",
  "recipes.dataset.inspect",
  "recipe_import.create",
  "recipe_import.status",
  "pantry.read",
  "pantry.reconcile",
  "shopping_list.read",
  "cook_log.read",
  "cook_log.append",
  "cooking_insights.read",
] as const satisfies readonly RecipeAuthorizationAction[];

export type RecipeAuthorizationPrincipal = {
  id: string;
  kind: "agent" | "anonymous" | "user";
  userId: string;
  grantVerified: boolean;
};

export type RecipeAuthorizationResource = {
  id: string;
  type: "CapabilityInvocation" | "Household" | "OwnedResource" | "Recipe";
  attrs: Record<string, boolean | string>;
};

export type RecipeAuthorizationRequest = {
  action: RecipeAuthorizationAction;
  principal: RecipeAuthorizationPrincipal;
  resource: RecipeAuthorizationResource;
  context?: Record<string, boolean | string>;
};

export type RecipePolicyDecision =
  | { allowed: true; determiningPolicies: string[] }
  | { allowed: false; diagnostics: string[] };

const schema = schemaJson as cedar.Schema;
const policySet = compileCedarPolicySet({
  engine: cedar,
  label: "Recipe authorization",
  policies: RECIPE_AUTHORIZATION_POLICY,
  schema,
});

export function authorizeRecipePolicy(
  requestInput: RecipeAuthorizationRequest,
): RecipePolicyDecision {
  const action = RecipeAuthorizationActionSchema.safeParse(requestInput.action);
  if (!action.success) {
    return {
      allowed: false,
      diagnostics: action.error.issues.map((issue) => issue.message),
    };
  }

  const answer = policySet.authorize({
    principal: {
      type: "RecipeSite::Actor",
      id: requestInput.principal.id,
    },
    action: { type: "RecipeSite::Action", id: action.data },
    resource: {
      type: `RecipeSite::${requestInput.resource.type}`,
      id: requestInput.resource.id,
    },
    context: requestInput.context ?? {},
    schema,
    validateRequest: true,
    entities: [
      {
        uid: {
          type: "RecipeSite::Actor",
          id: requestInput.principal.id,
        },
        attrs: {
          grantVerified: requestInput.principal.grantVerified,
          kind: requestInput.principal.kind,
          userId: requestInput.principal.userId,
        },
        parents: [],
      },
      {
        uid: {
          type: `RecipeSite::${requestInput.resource.type}`,
          id: requestInput.resource.id,
        },
        attrs: requestInput.resource.attrs,
        parents: [],
      },
    ],
  });

  return answer.decision === "allow"
    ? { allowed: true, determiningPolicies: answer.determiningPolicies }
    : { allowed: false, diagnostics: answer.diagnostics };
}

export function anonymousRecipePrincipal(): RecipeAuthorizationPrincipal {
  return {
    id: "anonymous",
    kind: "anonymous",
    userId: "",
    grantVerified: false,
  };
}

export function userRecipePrincipal(userId: string): RecipeAuthorizationPrincipal {
  return {
    id: `user:${userId}`,
    kind: "user",
    userId,
    grantVerified: false,
  };
}

export function agentRecipePrincipal(
  agentId: string,
  delegatedUserId: string,
  grantVerified: boolean,
): RecipeAuthorizationPrincipal {
  return {
    id: `agent:${agentId}`,
    kind: "agent",
    userId: delegatedUserId,
    grantVerified,
  };
}
