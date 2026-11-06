import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/process.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

async function inventory(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === ".git") return [];
      const item = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) return inventory(root, item);
      return [`${item}\0${await readFile(path.join(root, item), "utf8")}`];
    }),
  );
  return files.flat().toSorted();
}

async function renderRuntimeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "authenticated-runtime-"));
  temporaryRoots.push(root);
  const template = path.join(root, "template");
  const output = path.join(root, "output");
  await mkdir(template, { recursive: true });
  await cp(path.join(repositoryRoot, "copier.yml"), path.join(template, "copier.yml"));
  await cp(
    path.join(repositoryRoot, "copier-templates"),
    path.join(template, "copier-templates"),
    { recursive: true },
  );
  await runCommand("git", ["-C", template, "init", "--quiet"]);
  await runCommand("git", ["-C", template, "add", "--all"]);
  await runCommand("git", [
    "-C",
    template,
    "-c",
    "user.name=Runtime Fixture",
    "-c",
    "user.email=runtime-fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Runtime fixture template",
  ]);
  const revision = (
    await runCommand("git", ["-C", template, "rev-parse", "HEAD"])
  ).stdout.trim();
  const blueprint = {
    project: {
      id: "runtime-fixture",
      stable_id: "project:runtime-fixture",
      name: "Runtime fixture",
    },
    components: [
      {
        id: "runtime-fixture-api",
        stable_id: "component:runtime-fixture/runtime-fixture-api",
        name: "Runtime fixture API",
        kind: "worker",
        path: "workers/runtime-fixture-api",
        template_ownership: "structure-only",
        runtime_role: "authenticated-worker",
      },
      {
        id: "runtime-fixture-contracts",
        stable_id: "component:runtime-fixture/runtime-fixture-contracts",
        name: "Runtime fixture contracts",
        kind: "typescript-package",
        path: "packages/runtime-fixture-contracts",
        template_ownership: "structure-only",
        runtime_role: "api-contracts",
      },
      {
        id: "runtime-fixture-data",
        stable_id: "component:runtime-fixture/runtime-fixture-data",
        name: "Runtime fixture data",
        kind: "typescript-package",
        path: "packages/runtime-fixture-data",
        template_ownership: "structure-only",
        runtime_role: "relational-data",
      },
    ],
    selections: [],
    rollout: { operational_checks: [], migration_checkpoints: [] },
  };
  const dataFile = path.join(root, "data.yaml");
  await writeFile(
    dataFile,
    stringify({ project_id: "runtime-fixture", blueprint }),
    "utf8",
  );
  await runCommand("copier", [
    "copy",
    "--defaults",
    "--trust",
    "--vcs-ref",
    revision,
    "--data-file",
    dataFile,
    template,
    output,
  ]);
  await runCommand("git", ["-C", output, "init", "--quiet"]);
  await runCommand("git", ["-C", output, "add", "--all"]);
  await runCommand("git", [
    "-C",
    output,
    "-c",
    "user.name=Runtime Fixture",
    "-c",
    "user.email=runtime-fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Generated runtime fixture",
  ]);
  return { output, revision };
}

describe("authenticated Worker runtime template", () => {
  it("renders the selected runtime without recording secret values", async () => {
    const { output } = await renderRuntimeFixture();
    const worker = path.join(output, "workers/runtime-fixture-api");
    const data = path.join(output, "packages/runtime-fixture-data");
    const workerManifest = parse(
      await readFile(path.join(worker, "generated-component.yaml"), "utf8"),
    );
    const dataManifest = parse(
      await readFile(path.join(data, "generated-component.yaml"), "utf8"),
    );

    expect(workerManifest.ownership).toMatchObject({
      runtime_role: "authenticated-worker",
      project_extensions: [
        "src/project-authorization.ts",
        "src/project-routes.ts",
      ],
    });
    expect(dataManifest.ownership).toMatchObject({
      runtime_role: "relational-data",
      project_extensions: ["src/project-schema.ts"],
    });
    await expect(readFile(path.join(worker, "src/auth.ts"), "utf8")).resolves.toContain(
      "drizzleAdapter",
    );
    await expect(readFile(path.join(worker, "src/runtime.ts"), "utf8")).resolves.toContain(
      'app.on(["GET", "POST"], "/api/auth/*"',
    );
    await expect(readFile(path.join(data, "drizzle.config.ts"), "utf8")).resolves.toContain(
      '"./src/project-schema.ts"',
    );
    const receipt = await readFile(path.join(output, ".copier-answers.yml"), "utf8");
    expect(receipt).not.toContain("fixture-secret-value");
  });

  it("preserves project routes, authorization, and schema across empty updates", async () => {
    const { output, revision } = await renderRuntimeFixture();
    const extensions = new Map([
      [
        "workers/runtime-fixture-api/src/project-routes.ts",
        "export const projectRouteMarker = 'owned-route';\n",
      ],
      [
        "workers/runtime-fixture-api/src/project-authorization.ts",
        "export const projectAuthorizationMarker = 'owned-policy';\n",
      ],
      [
        "packages/runtime-fixture-data/src/project-schema.ts",
        "export const projectSchemaMarker = 'owned-schema';\n",
      ],
    ]);
    for (const [relativePath, contents] of extensions) {
      await writeFile(path.join(output, relativePath), contents, "utf8");
    }
    await runCommand("git", ["-C", output, "add", "--all"]);
    await runCommand("git", [
      "-C",
      output,
      "-c",
      "user.name=Runtime Fixture",
      "-c",
      "user.email=runtime-fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Add project runtime extensions",
    ]);

    await runCommand("copier", [
      "update",
      "--defaults",
      "--trust",
      "--vcs-ref",
      revision,
    ], { cwd: output });
    for (const [relativePath, contents] of extensions) {
      await expect(readFile(path.join(output, relativePath), "utf8")).resolves.toBe(
        contents,
      );
    }

    const before = await inventory(output);
    await runCommand("copier", [
      "update",
      "--defaults",
      "--trust",
      "--vcs-ref",
      revision,
    ], { cwd: output });
    expect(await inventory(output)).toEqual(before);
  });
});
