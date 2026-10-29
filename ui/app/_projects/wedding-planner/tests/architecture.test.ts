import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = join(projectRoot, "../../../..");
const domainRoot = join(repositoryRoot, "packages/wedding-planner-domain/src");
const routeRoot = join(repositoryRoot, "ui/app/wedding-planner");
const productionRoots = [
  join(projectRoot, "application"),
  join(projectRoot, "components"),
];

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function imports(source: string): string[] {
  return [
    ...source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
}

function projectPath(path: string): string {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

describe("wedding planner dependency boundaries", () => {
  it("keeps the domain package independent of React, routes, and browser persistence", () => {
    const violations = sourceFiles(domainRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const forbiddenImports = imports(source).filter(
        (specifier) =>
          specifier === "react" ||
          specifier.startsWith("react/") ||
          specifier === "next" ||
          specifier.startsWith("next/") ||
          specifier.startsWith("@/") ||
          specifier.includes("app/_projects"),
      );
      const browserGlobals = source.match(
        /\b(?:localStorage|sessionStorage|navigator)\b|\b(?:window|document)\s*\./g,
      );
      return forbiddenImports.length || browserGlobals
        ? [
            {
              path: projectPath(path),
              forbiddenImports,
              browserGlobals: browserGlobals ?? [],
            },
          ]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("does not reach into another project's private source", () => {
    const violations = sourceFiles(projectRoot).flatMap((path) =>
      imports(readFileSync(path, "utf8"))
        .filter(
          (specifier) =>
            specifier.startsWith("@/app/_projects/") &&
            !specifier.startsWith("@/app/_projects/wedding-planner/"),
        )
        .map((specifier) => ({ path: projectPath(path), specifier })),
    );

    expect(violations).toEqual([]);
  });

  it("keeps the application layer independent of React components", () => {
    const applicationRoot = join(projectRoot, "application");
    const violations = sourceFiles(applicationRoot).flatMap((path) =>
      imports(readFileSync(path, "utf8"))
        .filter(
          (specifier) =>
            specifier === "react" ||
            specifier.startsWith("react/") ||
            specifier.includes("/components/") ||
            specifier.startsWith("../components"),
        )
        .map((specifier) => ({ path: projectPath(path), specifier })),
    );

    expect(violations).toEqual([]);
  });

  it("keeps persistence and saved-plan parsing out of React components", () => {
    const componentRoot = join(projectRoot, "components");
    const violations = sourceFiles(componentRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const forbiddenImports = imports(source).filter((specifier) =>
        /application\/(?:browser-repository|state|editor-projection)$/.test(
          specifier,
        ),
      );
      const persistenceCalls = source.match(
        /\b(?:localStorage|sessionStorage|JSON\.parse)\b/g,
      );
      return forbiddenImports.length || persistenceCalls
        ? [
            {
              path: projectPath(path),
              forbiddenImports,
              persistenceCalls: persistenceCalls ?? [],
            },
          ]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("parses serialized plans only at the plan codec boundary", () => {
    const parsingFiles = productionRoots
      .flatMap(sourceFiles)
      .filter((path) => readFileSync(path, "utf8").includes("JSON.parse"))
      .map(projectPath);

    expect(parsingFiles).toEqual([
      "ui/app/_projects/wedding-planner/application/plan-codec.ts",
    ]);
  });

  it("keeps public routes as adapters to wedding-owned UI", () => {
    const violations = sourceFiles(routeRoot).flatMap((path) =>
      imports(readFileSync(path, "utf8"))
        .filter(
          (specifier) =>
            specifier.startsWith("@/") &&
            !specifier.startsWith("@/app/_projects/wedding-planner/"),
        )
        .map((specifier) => ({ path: projectPath(path), specifier })),
    );

    expect(violations).toEqual([]);
  });
});
