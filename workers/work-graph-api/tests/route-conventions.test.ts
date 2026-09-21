import { describe, expect, it } from "vitest";
import {
  createWorkGraphApp,
  type WorkGraphApiRepository,
} from "../src/index";

const unavailable = async (): Promise<never> => {
  throw new Error("Repository operations are unavailable in route tests.");
};
const app = createWorkGraphApp({
  listKnowledgeScopes: unavailable,
  getKnowledgeScope: unavailable,
  putKnowledgeScope: unavailable,
  moveKnowledgeScopePriority: unavailable,
  listKnowledgeScopeRelationships: unavailable,
  addKnowledgeScopeRelationship: unavailable,
  removeKnowledgeScopeRelationship: unavailable,
  listWorkItems: unavailable,
  getWorkItem: unavailable,
  resolveWorkItemContext: unavailable,
  listNotes: unavailable,
  listEvents: unavailable,
  listDependencies: unavailable,
  listLeases: unavailable,
  listAttentionRequests: unavailable,
  createWorkItem: unavailable,
  putWorkItemContext: unavailable,
  putWorkItemArchitectureDecision: unavailable,
  putWorkItemReference: unavailable,
  refreshPullRequest: unavailable,
  putWorkItemPullRequest: unavailable,
  moveWorkItemPriority: unavailable,
  reparentWorkItem: unavailable,
  setWorkItemSchedulingScope: unavailable,
  expediteWorkItem: unavailable,
  unexpediteWorkItem: unavailable,
  addDependency: unavailable,
  removeDependency: unavailable,
  createNote: unavailable,
  createPostReleaseNote: unavailable,
  createAttentionRequest: unavailable,
  resolveAttentionRequest: unavailable,
  claimWorkItem: unavailable,
  renewLease: unavailable,
  terminateClaimedWorkItem: unavailable,
  decomposeClaimedWorkItem: unavailable,
} satisfies WorkGraphApiRepository);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

type Route = { method: string; path: string };

const httpRoutes = (): Route[] => {
  const routes = new Map<string, Route>();
  for (const route of app.routes as Route[]) {
    if (!HTTP_METHODS.has(route.method)) continue;
    routes.set(`${route.method} ${route.path}`, route);
  }
  return [...routes.values()];
};

describe("Given the Work Graph route registry", () => {
  it("documents every runtime route in generated OpenAPI", () => {
    const document = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "route parity", version: "test" },
    });
    const documented = Object.entries(document.paths ?? {}).flatMap(
      ([path, pathItem]) =>
        Object.keys(pathItem ?? {})
          .filter((method) => HTTP_METHODS.has(method.toUpperCase()))
          .map((method) => `${method.toUpperCase()} ${path}`),
    );
    const runtime = httpRoutes().map(
      ({ method, path }) =>
        `${method} ${path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`,
    );

    expect(documented.sort()).toEqual(runtime.sort());
  });

  it("uses noun-based kebab-case paths without trailing slashes", () => {
    const offenders = httpRoutes().filter(({ path }) => {
      if (path.endsWith("/")) return true;
      return path
        .split("/")
        .filter((segment) => segment && !segment.startsWith(":"))
        .some((segment) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment));
    });

    expect(offenders).toEqual([]);
    expect(
      httpRoutes()
        .map(({ method, path }) => `${method} ${path}`)
        .sort(),
    ).toEqual(
      [
        "DELETE /api/dependencies",
        "DELETE /api/knowledge-scope-relationships",
        "DELETE /api/work-items/:workItemId/expedites",
        "GET /api/attention-requests",
        "GET /api/knowledge-scope-relationships",
        "GET /api/knowledge-scopes",
        "GET /api/knowledge-scopes/:knowledgeScopeId",
        "GET /api/work-items",
        "GET /api/work-items/:workItemId",
        "GET /api/work-items/:workItemId/contexts",
        "GET /api/work-items/:workItemId/dependencies",
        "GET /api/work-items/:workItemId/events",
        "GET /api/work-items/:workItemId/leases",
        "GET /api/work-items/:workItemId/notes",
        "GET /api/work-items/:workItemId/pull-requests",
        "POST /api/attention-requests",
        "POST /api/attention-requests/:attentionRequestId/resolutions",
        "POST /api/dependencies",
        "POST /api/knowledge-scope-relationships",
        "POST /api/knowledge-scopes/:knowledgeScopeId/priority-moves",
        "POST /api/leases",
        "POST /api/leases/:leaseId/renewals",
        "POST /api/work-items",
        "POST /api/work-items/:workItemId/cancellations",
        "POST /api/work-items/:workItemId/comments",
        "POST /api/work-items/:workItemId/decompositions",
        "POST /api/work-items/:workItemId/expedites",
        "POST /api/work-items/:workItemId/notes",
        "POST /api/work-items/:workItemId/priority-moves",
        "POST /api/work-items/:workItemId/releases",
        "PUT /api/knowledge-scopes/:knowledgeScopeId",
        "PUT /api/pull-requests",
        "PUT /api/work-items/:workItemId/contexts",
        "PUT /api/work-items/:workItemId/parent",
        "PUT /api/work-items/:workItemId/pull-requests",
        "PUT /api/work-items/:workItemId/references",
        "PUT /api/work-items/:workItemId/scheduling-scope",
      ].sort(),
    );
  });
});
