import { describe, expect, it } from "vitest";
import { dependencyState } from "@/scripts/dependency-version-changed";

const packageJSON = JSON.stringify({
  dependencies: { mermaid: "^11.12.1", react: "^19.2.0" },
});

function lockfile(mermaid: string, react = "19.3.0"): string {
  return `
lockfileVersion: '9.0'
importers:
  ui:
    dependencies:
      mermaid:
        specifier: ^11.12.1
        version: ${mermaid}
      react:
        specifier: ^19.2.0
        version: ${react}
`;
}

describe("dependencyState", () => {
  it("reads the declared range and resolved version", () => {
    expect(
      dependencyState(packageJSON, lockfile("11.17.2"), "ui", "mermaid"),
    ).toEqual({ declared: "^11.12.1", resolved: "11.17.2" });
  });

  it("finds the package importer in a multi-document pnpm lockfile", () => {
    const multiDocumentLockfile = `
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.4.2
        version: 12.4.2
---
${lockfile("11.17.2")}
`;

    expect(
      dependencyState(packageJSON, multiDocumentLockfile, "ui", "mermaid"),
    ).toEqual({ declared: "^11.12.1", resolved: "11.17.2" });
  });

  it("ignores changes to other dependencies", () => {
    const before = dependencyState(
      packageJSON,
      lockfile("11.17.2", "19.2.0"),
      "ui",
      "mermaid",
    );
    const after = dependencyState(
      packageJSON,
      lockfile("11.17.2", "19.3.0"),
      "ui",
      "mermaid",
    );

    expect(after).toEqual(before);
  });

  it("reports an absent dependency without failing", () => {
    expect(
      dependencyState(packageJSON, lockfile("11.17.2"), "ui", "d3"),
    ).toEqual({ declared: undefined, resolved: undefined });
  });
});
