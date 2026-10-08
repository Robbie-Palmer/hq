import { describe, expect, it, vi } from "vitest";

// Route enumeration only reads `app.routes`; handlers never execute here. The
// postgres stub keeps importing the app free of any driver import-time work,
// mirroring the pattern the behavioural suites use.
vi.mock("postgres", () => ({ default: () => ({}) }));

import { app, routeMetadata } from "../src/index";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// Segments that are legitimate non-CRUD state transitions, not resources.
const ACTION_ALLOWLIST = new Set([
  "accept",
  "decline",
  "leave",
  "read-all",
  "clear-all",
]);

// A segment is "verb-shaped" when its leading hyphen-token is one of these.
// Named read views (discover, cooks) are intentionally absent.
const VERB_PREFIXES = new Set([
  "import",
  "restore",
  "recommend",
  "generate",
  "validate",
  "sync",
  "create",
  "update",
  "delete",
  "fetch",
  "send",
]);

type Route = { method: string; path: string };
type OpenApiParameter = {
  in?: string;
  name?: string;
  required?: boolean;
  schema?: {
    enum?: string[];
    format?: string;
    maxLength?: number;
    type?: string;
  };
};

function httpRoutes(): Route[] {
  const seen = new Set<string>();
  const routes: Route[] = [];
  for (const { method, path } of app.routes as Route[]) {
    // Skip middleware, which Hono records with the ALL method.
    if (!HTTP_METHODS.has(method)) continue;
    const key = `${method} ${path}`;
    if (seen.has(key)) continue; // collapse per-handler duplicate entries
    seen.add(key);
    routes.push({ method, path });
  }
  return routes;
}

function staticSegments(path: string): string[] {
  // Exclude dynamic segments: Hono params (:id) and wildcards (*), e.g. the
  // better-auth sub-app mounted at /api/auth/*.
  return path
    .split("/")
    .filter((s) => s.length > 0 && !s.startsWith(":") && s !== "*");
}

function hasVerbSegment(path: string): boolean {
  return staticSegments(path).some(
    (segment) =>
      !ACTION_ALLOWLIST.has(segment) &&
      VERB_PREFIXES.has(segment.split("-")[0] ?? ""),
  );
}

describe("recipe-api route conventions", () => {
  const routes = httpRoutes();

  it("registers only standard HTTP methods", () => {
    const offenders = (app.routes as Route[])
      .map((r) => r.method)
      .filter((method) => method !== "ALL" && !HTTP_METHODS.has(method));
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("uses kebab-case static path segments", () => {
    const offenders = routes.filter(({ path }) =>
      staticSegments(path).some(
        (s) =>
          s !== ".well-known" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s),
      ),
    );
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("has no trailing slashes", () => {
    const offenders = routes.filter(
      ({ path }) => path !== "/" && path.endsWith("/"),
    );
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("keeps verbs out of paths except for allowlisted state transitions", () => {
    const offenders = routes.filter(
      ({ path }) => hasVerbSegment(path),
    );
    expect(
      offenders,
      `verb-shaped path segments: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });

  it("documents every registered route in the generated OpenAPI contract", () => {
    const document = app.getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "route parity", version: "test" },
    });
    const documented = new Set(
      Object.entries(document.paths).flatMap(([path, pathItem]) =>
        Object.keys(pathItem ?? {})
          .filter((method) => HTTP_METHODS.has(method.toUpperCase()))
          .map((method) => `${method.toUpperCase()} ${path}`),
      ),
    );
    const registered = new Set(
      routes
        // Better Auth owns a wildcard handler whose concrete endpoints vary
        // with its pinned configuration. ADR 065 governs the recipe API routes
        // registered through createRoute; the auth adapter remains isolated at
        // this explicit boundary.
        .filter(({ path }) => path !== "/api/auth/*")
        .map(
          ({ method, path }) =>
            `${method} ${path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`,
        ),
    );

    expect([...documented].sort()).toEqual([...registered].sort());
  });

  it("registers every route from the shared metadata table", () => {
    const registered = routes
      .filter(({ path }) => path !== "/api/auth/*")
      .map(({ method, path }) => `${method} ${path}`)
      .sort();

    expect(registered).toEqual(Object.keys(routeMetadata).sort());
  });

  it("documents constrained route parameters", () => {
    const document = app.getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "route parameters", version: "test" },
    });
    const householdParameters = document.paths["/households/{householdId}"]
      ?.patch?.parameters as OpenApiParameter[] | undefined;
    const notificationParameters = document.paths[
      "/notifications/{notificationId}/actions/{actionKey}"
    ]?.post?.parameters as OpenApiParameter[] | undefined;

    expect(
      householdParameters?.find(({ name }) => name === "householdId"),
    ).toMatchObject({
      in: "path",
      required: true,
      schema: { format: "uuid", maxLength: 36, type: "string" },
    });
    expect(
      notificationParameters?.find(({ name }) => name === "actionKey"),
    ).toMatchObject({
      in: "path",
      required: true,
      schema: {
        enum: ["accept", "decline", "add_to_recipe_box"],
        type: "string",
      },
    });
  });
});
