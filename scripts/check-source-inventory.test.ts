import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { SourceInventory } from "platform-contracts/source-inventory";
import {
  buildAdoptionBatches,
  validateSourceInventory,
} from "./check-source-inventory.js";

const execFileAsync = promisify(execFile);

async function fixtureRepository(initializeGit = true): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "source-inventory-"));
  await Promise.all([
    mkdir(path.join(root, "packages/managed"), { recursive: true }),
    mkdir(path.join(root, "packages/planned"), { recursive: true }),
    mkdir(path.join(root, "scripts"), { recursive: true }),
    mkdir(path.join(root, "ui/content/projects/alpha"), { recursive: true }),
    mkdir(path.join(root, ".copier/projects"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(root, ".mise.toml"),
      '[monorepo]\nconfig_roots = ["packages/managed", "packages/planned"]\n',
    ),
    writeFile(path.join(root, "packages/managed/index.ts"), "export {};\n"),
    writeFile(path.join(root, "packages/planned/index.ts"), "export {};\n"),
    writeFile(path.join(root, "packages/planned/generated.tmp"), "ignored\n"),
    writeFile(path.join(root, ".gitignore"), "*.tmp\n"),
    writeFile(path.join(root, "scripts/check.ts"), "export {};\n"),
    writeFile(path.join(root, "ui/content/projects/alpha/index.mdx"), "# Alpha\n"),
    writeFile(
      path.join(root, "ui/content/projects/alpha/project-profile.yaml"),
      "project:\n  id: alpha\ncomponents:\n  - id: managed\n",
    ),
    writeFile(
      path.join(root, ".copier/projects/alpha.yml"),
      "blueprint:\n  project:\n    id: alpha\n  components:\n    - stable_id: component:alpha/managed\n      path: packages/managed\n",
    ),
  ]);
  if (initializeGit) {
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  }
  return root;
}

function inventory(): SourceInventory {
  return {
    schema_version: 1,
    additional_roots: ["scripts"],
    components: [
      {
        id: "component:alpha/managed",
        project: "project:alpha",
        paths: ["packages/managed"],
        toolchains: ["typescript"],
        profile: {
          path: "ui/content/projects/alpha/project-profile.yaml",
          component_id: "managed",
        },
        receipt: { path: ".copier/projects/alpha.yml" },
        adoption: { state: "managed", batch: null },
      },
      {
        id: "component:alpha/planned",
        project: "project:alpha",
        paths: ["packages/planned"],
        toolchains: ["typescript"],
        profile: null,
        receipt: null,
        adoption: { state: "planned", batch: "01-alpha" },
      },
      {
        id: "component:alpha/repository-tools",
        project: "project:alpha",
        paths: ["scripts"],
        toolchains: ["typescript"],
        profile: null,
        receipt: null,
        adoption: { state: "planned", batch: "01-alpha" },
      },
    ],
    exclusions: [],
  };
}

describe("managed source inventory", () => {
  it("validates owners, coverage, profiles, and receipts", async () => {
    const root = await fixtureRepository();

    await expect(validateSourceInventory(root, inventory())).resolves.toEqual([]);
  });

  it("falls back to filesystem discovery outside a Git checkout", async () => {
    const root = await fixtureRepository(false);

    await expect(validateSourceInventory(root, inventory())).resolves.toEqual([]);
  });

  it("rejects duplicate, cross-project, and inconsistent adoption claims", async () => {
    const root = await fixtureRepository();
    const value = inventory();
    value.additional_roots.push("scripts");
    value.components.push({ ...value.components[0] });
    value.components[0].receipt = null;
    value.components[1].project = "project:beta";
    value.components[1].paths.push("packages/planned");
    value.components[1].toolchains.push("typescript");
    value.components[1].receipt = { path: ".copier/projects/alpha.yml" };

    await expect(validateSourceInventory(root, value)).resolves.toEqual(
      expect.arrayContaining([
        "Duplicate additional root 'scripts'",
        "Duplicate component ID 'component:alpha/managed'",
        "Managed component 'component:alpha/managed' has no Copier receipt",
        "Component 'component:alpha/planned' is not owned by 'project:beta'",
        "Component 'component:alpha/planned' repeats path 'packages/planned'",
        "Component 'component:alpha/planned' repeats toolchain 'typescript'",
        "planned component 'component:alpha/planned' cannot claim Copier receipt coverage",
      ]),
    );
  });

  it("rejects overlaps and uncovered maintained files", async () => {
    const root = await fixtureRepository();
    const value = inventory();
    value.components[2].paths = ["scripts/check.ts"];
    value.exclusions.push({
      path: "packages/managed/index.ts",
      reason: "Invalid overlap",
    });

    await expect(validateSourceInventory(root, value)).resolves.toEqual(
      expect.arrayContaining([
        expect.stringContaining("Overlapping source claims 'packages/managed'"),
      ]),
    );

    value.components[2].paths = [];
    value.exclusions.pop();
    await expect(validateSourceInventory(root, value)).resolves.toContain(
      "Maintained file 'scripts/check.ts' has no source inventory owner",
    );
  });

  it("generates stable adoption batches", () => {
    expect(buildAdoptionBatches(inventory())).toEqual([
      {
        id: "01-alpha",
        components: [
          {
            id: "component:alpha/planned",
            project: "project:alpha",
            paths: ["packages/planned"],
            toolchains: ["typescript"],
            profile: null,
          },
          {
            id: "component:alpha/repository-tools",
            project: "project:alpha",
            paths: ["scripts"],
            toolchains: ["typescript"],
            profile: null,
          },
        ],
      },
    ]);
  });
});
