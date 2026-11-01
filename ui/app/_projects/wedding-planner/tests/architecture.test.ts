import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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

function moduleSpecifier(node: ts.Node): string | null {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  if (
    !ts.isCallExpression(node) ||
    (node.expression.kind !== ts.SyntaxKind.ImportKeyword &&
      (!ts.isIdentifier(node.expression) || node.expression.text !== "require"))
  ) {
    return null;
  }
  const [argument] = node.arguments;
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
}

function importSpecifiers(source: string, path: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    const specifier = moduleSpecifier(node);
    if (specifier) specifiers.push(specifier);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function projectPath(path: string): string {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function sourceModulePath(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
}

interface ImportReference {
  localPath: string | null;
  specifier: string;
}

function resolveImportReference(
  path: string,
  specifier: string,
): ImportReference {
  let localPath: string | null = null;
  if (specifier.startsWith("@/")) {
    localPath = projectPath(
      sourceModulePath(join(repositoryRoot, "ui", specifier.slice(2))),
    );
  } else if (specifier.startsWith(".")) {
    localPath = projectPath(
      sourceModulePath(resolve(dirname(path), specifier)),
    );
  }
  return { localPath, specifier };
}

function importReferences(path: string): ImportReference[] {
  return importSpecifiers(readFileSync(path, "utf8"), path).map((specifier) =>
    resolveImportReference(path, specifier),
  );
}

describe("wedding planner dependency boundaries", () => {
  it("recognizes every supported import form and resolves local paths", () => {
    const importer = join(projectRoot, "components/import-fixture.tsx");
    const source = `
      import "react";
      import type { WeddingPlan } from "wedding-planner-domain";
      export { privateValue } from "../../personal-finance/private";
      void import("../application/state");
      void import("../application/state.js");
      const legacy = require("../application/values");
    `;

    expect(importSpecifiers(source, importer)).toEqual([
      "react",
      "wedding-planner-domain",
      "../../personal-finance/private",
      "../application/state",
      "../application/state.js",
      "../application/values",
    ]);
    expect(
      resolveImportReference(importer, "../../personal-finance/private"),
    ).toEqual({
      localPath: "ui/app/_projects/personal-finance/private",
      specifier: "../../personal-finance/private",
    });
    expect(resolveImportReference(importer, "../application/state.js")).toEqual(
      {
        localPath: "ui/app/_projects/wedding-planner/application/state",
        specifier: "../application/state.js",
      },
    );
  });

  it("keeps the domain package independent of React, routes, and browser persistence", () => {
    const violations = sourceFiles(domainRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const forbiddenImports = importReferences(path).filter(
        ({ localPath, specifier }) =>
          specifier === "react" ||
          specifier.startsWith("react/") ||
          specifier === "next" ||
          specifier.startsWith("next/") ||
          localPath?.startsWith("ui/") === true,
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
      importReferences(path)
        .filter(
          ({ localPath }) =>
            localPath?.startsWith("ui/app/_projects/") === true &&
            !localPath.startsWith("ui/app/_projects/wedding-planner/"),
        )
        .map((reference) => ({ path: projectPath(path), ...reference })),
    );

    expect(violations).toEqual([]);
  });

  it("keeps the application layer independent of React components", () => {
    const applicationRoot = join(projectRoot, "application");
    const violations = sourceFiles(applicationRoot).flatMap((path) =>
      importReferences(path)
        .filter(
          ({ localPath, specifier }) =>
            specifier === "react" ||
            specifier.startsWith("react/") ||
            localPath?.startsWith(
              "ui/app/_projects/wedding-planner/components/",
            ) === true,
        )
        .map((reference) => ({ path: projectPath(path), ...reference })),
    );

    expect(violations).toEqual([]);
  });

  it("keeps persistence and saved-plan parsing out of React components", () => {
    const componentRoot = join(projectRoot, "components");
    const violations = sourceFiles(componentRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const forbiddenImports = importReferences(path).filter(({ localPath }) =>
        /ui\/app\/_projects\/wedding-planner\/application\/(?:browser-repository|state|editor-projection)$/.test(
          localPath ?? "",
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
      importReferences(path)
        .filter(
          ({ localPath }) =>
            localPath !== null &&
            !localPath.startsWith("ui/app/_projects/wedding-planner/"),
        )
        .map((reference) => ({ path: projectPath(path), ...reference })),
    );

    expect(violations).toEqual([]);
  });
});
