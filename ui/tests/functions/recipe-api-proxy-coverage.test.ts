import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const functionsDir = path.join(repoRoot, "functions");

const workerSource = fs.readFileSync(
  path.join(repoRoot, "workers/recipe-api/src/index.ts"),
  "utf8",
);

const workerApiPaths = [
  ...new Set(
    [
      ...workerSource.matchAll(
        /^\s*"(?:GET|POST|PUT|PATCH|DELETE) (\/api\/[^"]+)":/gm,
      ),
    ].map((match) => match[1] as string),
  ),
];

function hasPagesFunction(routePath: string): boolean {
  const segments = routePath.split("/").filter(Boolean);
  const paramIndex = segments.findIndex((segment) => segment.startsWith(":"));
  const staticSegments =
    paramIndex === -1 ? segments : segments.slice(0, paramIndex);
  if (
    paramIndex === -1 &&
    fs.existsSync(`${path.join(functionsDir, ...segments)}.ts`)
  ) {
    return true;
  }
  for (let depth = staticSegments.length; depth >= 0; depth--) {
    const dir = path.join(functionsDir, ...staticSegments.slice(0, depth));
    if (
      fs.existsSync(dir) &&
      fs.readdirSync(dir).some((file) => /^\[\[[^\]]+\]\]\.ts$/.test(file))
    ) {
      return true;
    }
  }
  return false;
}

describe("recipe API Pages proxy coverage", () => {
  it("finds the worker /api routes", () => {
    expect(workerApiPaths).toContain("/api/profile/agent-mutations");
  });

  it.each(workerApiPaths)("has a Pages function for %s", (routePath) => {
    expect(hasPagesFunction(routePath)).toBe(true);
  });
});
