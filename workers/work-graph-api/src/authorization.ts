import * as cedar from "@cedar-policy/cedar-wasm";
import {
  type CedarAuthorizationDecision,
  compileCedarPolicySet,
} from "cedar-authorization";
import { z } from "zod";

export const WorkGraphAuthorityProfileSchema = z.enum([
  "authority:work-graph-full",
  "authority:work-graph-read-only",
]);
export type WorkGraphAuthorityProfile = z.infer<
  typeof WorkGraphAuthorityProfileSchema
>;

export const WorkGraphAuthorizationActionSchema = z.enum([
  "api.read",
  "api.write",
  "mcp.invoke",
]);
export type WorkGraphAuthorizationAction = z.infer<
  typeof WorkGraphAuthorizationActionSchema
>;

const WorkGraphAuthorizationRequestSchema = z
  .object({
    action: WorkGraphAuthorizationActionSchema,
    authorityProfileId: WorkGraphAuthorityProfileSchema,
    method: z.string().trim().min(1).max(16),
    path: z.string().trim().min(1).max(2_048),
    principalId: z.string().trim().min(1).max(200),
  })
  .strict();
export type WorkGraphAuthorizationRequest = z.infer<
  typeof WorkGraphAuthorizationRequestSchema
>;

export type WorkGraphAuthorizationDecision = CedarAuthorizationDecision;

const schema: cedar.Schema = {
  WorkGraph: {
    entityTypes: {
      AuthorityProfile: {},
      Client: {
        memberOfTypes: ["AuthorityProfile"],
      },
      ApiRoute: {
        shape: {
          type: "Record",
          attributes: {
            method: { type: "String" },
            path: { type: "String" },
          },
        },
      },
    },
    actions: {
      "api.read": {
        appliesTo: {
          principalTypes: ["Client"],
          resourceTypes: ["ApiRoute"],
        },
      },
      "api.write": {
        appliesTo: {
          principalTypes: ["Client"],
          resourceTypes: ["ApiRoute"],
        },
      },
      "mcp.invoke": {
        appliesTo: {
          principalTypes: ["Client"],
          resourceTypes: ["ApiRoute"],
        },
      },
    },
  },
};

const policyText = `
@id("allow-full-work-graph-access")
permit (
  principal in WorkGraph::AuthorityProfile::"authority:work-graph-full",
  action,
  resource is WorkGraph::ApiRoute
);

@id("allow-read-only-work-graph-reads")
permit (
  principal in WorkGraph::AuthorityProfile::"authority:work-graph-read-only",
  action == WorkGraph::Action::"api.read",
  resource is WorkGraph::ApiRoute
);

@id("forbid-read-only-work-graph-mutations")
forbid (
  principal in WorkGraph::AuthorityProfile::"authority:work-graph-read-only",
  action in [
    WorkGraph::Action::"api.write",
    WorkGraph::Action::"mcp.invoke"
  ],
  resource is WorkGraph::ApiRoute
);
`;

const policySet = compileCedarPolicySet({
  engine: cedar,
  label: "Work Graph authorization",
  policies: policyText,
  schema,
});

export interface WorkGraphAuthorizer {
  authorize(
    request: WorkGraphAuthorizationRequest,
  ): WorkGraphAuthorizationDecision;
}

export const workGraphAuthorizer: WorkGraphAuthorizer = {
  authorize(requestInput) {
    const parsedRequest = WorkGraphAuthorizationRequestSchema.safeParse(requestInput);
    if (!parsedRequest.success) {
      return {
        decision: "deny",
        reason: "cedar-evaluation-error",
        diagnostics: parsedRequest.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      };
    }
    const request = parsedRequest.data;
    const principal = {
      type: "WorkGraph::Client",
      id: request.principalId,
    };
    const resource = {
      type: "WorkGraph::ApiRoute",
      id: `${request.method}:${request.path}`,
    };
    return policySet.authorize({
      principal,
      action: {
        type: "WorkGraph::Action",
        id: request.action,
      },
      resource,
      context: {},
      schema,
      validateRequest: true,
      entities: [
        {
          uid: principal,
          attrs: {},
          parents: [
            {
              type: "WorkGraph::AuthorityProfile",
              id: request.authorityProfileId,
            },
          ],
        },
        {
          uid: resource,
          attrs: { method: request.method, path: request.path },
          parents: [],
        },
      ],
    });
  },
};

export const workGraphActionForRequest = (
  method: string,
  path: string,
): WorkGraphAuthorizationAction => {
  if (path === "/mcp") return "mcp.invoke";
  return ["GET", "HEAD", "OPTIONS", "QUERY"].includes(method.toUpperCase())
    ? "api.read"
    : "api.write";
};
