import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parseCliArguments } from "../src/cli.js";
import {
  parseProjectPlan,
  parseTemplateRegistry,
  projectPlanSchema,
  templateRegistrySchema,
  type ProjectPlan,
  type TemplateSource,
} from "../src/contracts.js";
import { executeProjectPlan } from "../src/engine.js";
import { applySharedManifestEdits } from "../src/manifests.js";
import { runCommand } from "../src/process.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

async function temporaryDirectory(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `${label}-`));
  temporaryRoots.push(root);
  return root;
}

async function git(root: string, ...args: string[]): Promise<string> {
  return (await runCommand("git", ["-C", root, ...args])).stdout.trim();
}

async function commit(root: string, message: string): Promise<string> {
  await git(root, "add", "--all");
  await git(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  );
  return git(root, "rev-parse", "HEAD");
}

async function write(
  root: string,
  relativePath: string,
  source: string,
): Promise<void> {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, source, "utf8");
}

async function createTemplate(options?: {
  extraFile?: { path: string; source: string };
}): Promise<{ root: string; source: string; revision: string }> {
  const root = await temporaryDirectory("project-template");
  await git(root, "init", "--quiet", "--initial-branch=main");
  await write(
    root,
    "copier.yml",
    [
      "_min_copier_version: '9.18.2'",
      "project_id:",
      "  type: str",
      "message:",
      "  type: str",
      "",
    ].join("\n"),
  );
  await write(
    root,
    "{{ _copier_conf.answers_file }}.jinja",
    "# Managed by Copier; do not edit.\n{{ _copier_answers | to_nice_yaml -}}\n",
  );
  await write(
    root,
    "packages/{{ project_id }}/generated.txt.jinja",
    "{{ message }}\n",
  );
  if (options?.extraFile) {
    await write(root, options.extraFile.path, options.extraFile.source);
  }
  const revision = await commit(root, "Template v1");
  const remoteRoot = await temporaryDirectory("project-template-remote");
  const source = path.join(remoteRoot, `${path.basename(remoteRoot)}.git`);
  await runCommand("git", ["clone", "--quiet", "--bare", root, source]);
  await git(root, "remote", "add", "origin", source);
  return { root, source, revision };
}

async function commitTemplate(root: string, message: string): Promise<string> {
  const revision = await commit(root, message);
  await git(root, "push", "--quiet", "origin", "HEAD:main");
  return revision;
}

async function createRepository(): Promise<string> {
  const root = await temporaryDirectory("project-repository");
  await git(root, "init", "--quiet");
  await write(
    root,
    ".mise.toml",
    [
      "monorepo_root = true",
      "",
      "[monorepo]",
      "config_roots = [",
      '    "ui",',
      "]",
      "",
      "[tasks.fixture]",
      'run = "test -f packages/alpha/generated.txt"',
      "",
      "[tasks.mutate]",
      'run = "printf mutated >> packages/alpha/generated.txt"',
      "",
    ].join("\n"),
  );
  await write(
    root,
    "pnpm-workspace.yaml",
    "# workspace comment\npackages:\n  - 'ui'\n",
  );
  await write(
    root,
    "ui/content/projects/personal-engineering-platform/repository-layout.yaml",
    "schema_version: 1\nprojects: []\n",
  );
  await write(
    root,
    "ui/content/projects/personal-engineering-platform/platform.yaml",
    "schema_version: 1\ncatalog:\n  records: []\n",
  );
  await write(root, "ui/existing.txt", "keep\n");
  await commit(root, "Initial repository");
  return root;
}

function makePlan(revision: string, projectId = "alpha"): ProjectPlan {
  return projectPlanSchema.parse({
    schema_version: 1,
    project_id: projectId,
    template_id: "monorepo-project",
    template_revision: revision,
    answers: { project_id: projectId, message: `${projectId} v1` },
    owned_paths: [`packages/${projectId}`],
    shared_manifest_edits: [
      { kind: "mise_config_root", value: `packages/${projectId}` },
      { kind: "pnpm_workspace_package", value: `packages/${projectId}` },
      {
        kind: "repository_project",
        value: {
          id: projectId,
          kind: "library",
          catalog_record: `system:${projectId}/library`,
        },
      },
      {
        kind: "catalog_record",
        value: {
          id: `system:${projectId}/library`,
          kind: "system",
          project: `project:${projectId}`,
          source_paths: [`packages/${projectId}`],
        },
      },
    ],
  });
}

function templateSource(
  source: string,
  checks: string[] = [],
): TemplateSource {
  const registry = templateRegistrySchema.parse({
    schema_version: 1,
    templates: [
      { id: "monorepo-project", source, checks },
    ],
  });
  const template = registry.templates[0];
  if (!template) throw new Error("Missing fixture template");
  return template;
}

describe("project plan contracts", () => {
  it("parses plans and template registries", () => {
    expect(
      parseProjectPlan(
        "schema_version: 1\nproject_id: alpha\ntemplate_id: base\ntemplate_revision: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nanswers: {}\nowned_paths: [packages/alpha]\n",
      ).project_id,
    ).toBe("alpha");
    expect(
      parseTemplateRegistry(
        "schema_version: 1\ntemplates:\n  - id: base\n    source: https://example.invalid/template.git\n",
      ).templates[0]?.checks,
    ).toEqual([]);
  });

  it("rejects traversal, mutable revisions, duplicate ownership, and secret values", () => {
    const invalid = {
      schema_version: 1,
      project_id: "alpha",
      template_id: "base",
      template_revision: "main",
      answers: { nested: { api_token: "plaintext" } },
      owned_paths: ["../escape", "packages/alpha", "packages/alpha"],
    };
    expect(() => projectPlanSchema.parse(invalid)).toThrow(/template_revision/);
    const result = projectPlanSchema.safeParse({
      ...invalid,
      template_revision: "a".repeat(40),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(({ message }) => message).join(" ")).toMatch(
        /secret values are prohibited/,
      );
      expect(result.error.issues.map(({ message }) => message).join(" ")).toMatch(
        /duplicate owned path/,
      );
    }
  });

  it("allows secret references and rejects unsafe template source metadata", () => {
    expect(
      projectPlanSchema.parse({
        schema_version: 1,
        project_id: "alpha",
        template_id: "base",
        template_revision: "a".repeat(40),
        answers: { api_token_ref: "doppler://project/token" },
        owned_paths: ["packages/alpha"],
      }).answers,
    ).toEqual({ api_token_ref: "doppler://project/token" });
    expect(() =>
      templateRegistrySchema.parse({
        schema_version: 1,
        templates: [
          {
            id: "base",
            source: "https://user:password@example.invalid/template.git?token=x",
          },
        ],
      }),
    ).toThrow(/must not contain credentials/);
    expect(() =>
      templateRegistrySchema.parse({
        schema_version: 1,
        templates: [
          { id: "base", source: "/tmp/one" },
          { id: "base", source: "/tmp/two" },
        ],
      }),
    ).toThrow(/duplicate template id/);
    expect(() =>
      parseProjectPlan(
        "schema_version: 1\nproject_id: alpha\ntemplate_id: base\ntemplate_revision: invalid\nanswers: {}\nowned_paths: [packages/alpha]\n",
      ),
    ).toThrow(/Invalid project plan/);
    expect(
      projectPlanSchema.safeParse({
        schema_version: 1,
        project_id: "alpha",
        template_id: "base",
        template_revision: "a".repeat(40),
        answers: { nested: [{ token: "secret" }] },
        owned_paths: ["packages/alpha"],
      }).success,
    ).toBe(false);
  });
});

describe("shared manifest edits", () => {
  it("preserves unrelated content and is idempotent", async () => {
    const repository = await createRepository();
    const edits = makePlan("a".repeat(40)).shared_manifest_edits;
    await expect(applySharedManifestEdits(repository, edits)).resolves.toHaveLength(
      4,
    );
    await expect(applySharedManifestEdits(repository, edits)).resolves.toEqual([]);
    expect(await readFile(path.join(repository, ".mise.toml"), "utf8")).toContain(
      "[tasks.fixture]",
    );
    expect(
      await readFile(path.join(repository, "pnpm-workspace.yaml"), "utf8"),
    ).toContain("# workspace comment");
  });

  it("requires the declared previous value before replacing a record", async () => {
    const repository = await createRepository();
    const layoutPath = path.join(
      repository,
      "ui/content/projects/personal-engineering-platform/repository-layout.yaml",
    );
    await writeFile(
      layoutPath,
      "schema_version: 1\nprojects:\n  - id: alpha\n    kind: service\n    catalog_record: system:alpha/service\n",
      "utf8",
    );
    await expect(
      applySharedManifestEdits(repository, [
        {
          kind: "repository_project",
          expected: null,
          value: {
            id: "alpha",
            kind: "library",
            catalog_record: "system:alpha/library",
          },
        },
      ]),
    ).rejects.toThrow(/unexpected current value/);
    await expect(
      applySharedManifestEdits(repository, [
        {
          kind: "repository_project",
          expected: {
            id: "alpha",
            kind: "service",
            catalog_record: "system:alpha/service",
          },
          value: {
            id: "alpha",
            kind: "library",
            catalog_record: "system:alpha/library",
          },
        },
      ]),
    ).resolves.toEqual([
      "ui/content/projects/personal-engineering-platform/repository-layout.yaml",
    ]);
  });

  it("rejects malformed or structurally unexpected manifests", async () => {
    const repository = await createRepository();
    await writeFile(path.join(repository, "pnpm-workspace.yaml"), "packages: [\n", "utf8");
    await expect(
      applySharedManifestEdits(repository, [
        { kind: "pnpm_workspace_package", value: "packages/alpha" },
      ]),
    ).rejects.toThrow(/Cannot edit pnpm-workspace.yaml/);
    await writeFile(path.join(repository, "pnpm-workspace.yaml"), "packages: wrong\n", "utf8");
    await expect(
      applySharedManifestEdits(repository, [
        { kind: "pnpm_workspace_package", value: "packages/alpha" },
      ]),
    ).rejects.toThrow(/is not a sequence/);
    await writeFile(path.join(repository, ".mise.toml"), "[tasks.test]\nrun = 'true'\n", "utf8");
    await expect(
      applySharedManifestEdits(repository, [
        { kind: "mise_config_root", value: "packages/alpha" },
      ]),
    ).rejects.toThrow(/missing \[monorepo\] section/);
  });
});

describe("Copier engine", () => {
  it("creates a project from a dirty checkout and replans idempotently", async () => {
    const repository = await createRepository();
    const template = await createTemplate();
    await write(repository, "notes/local.txt", "unrelated working copy edit\n");
    const plan = makePlan(template.revision);

    const created = await executeProjectPlan({
      repository,
      mode: "create",
      plan,
      template: templateSource(template.source, ["//:fixture"]),
    });

    expect(created.applied).toBe(true);
    expect(created.operation).toBe("create");
    expect(created.checks).toEqual([{ task: "//:fixture", status: "passed" }]);
    expect(created.changedPaths).toEqual(
      expect.arrayContaining([
        ".copier/projects/alpha.yml",
        ".mise.toml",
        "packages/alpha/generated.txt",
        "pnpm-workspace.yaml",
      ]),
    );
    expect(
      await readFile(path.join(repository, "packages/alpha/generated.txt"), "utf8"),
    ).toBe("alpha v1\n");
    expect(await readFile(path.join(repository, "notes/local.txt"), "utf8")).toBe(
      "unrelated working copy edit\n",
    );
    const answers = parse(
      await readFile(
        path.join(repository, ".copier/projects/alpha.yml"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(answers._commit).toBe(template.revision);

    const betaPlan = makePlan(template.revision, "beta");
    const beta = await executeProjectPlan({
      repository,
      mode: "create",
      plan: betaPlan,
      template: templateSource(template.source),
    });
    expect(beta.applied).toBe(true);
    expect(
      await readFile(path.join(repository, "packages/beta/generated.txt"), "utf8"),
    ).toBe("beta v1\n");
    expect(
      await readFile(path.join(repository, "packages/alpha/generated.txt"), "utf8"),
    ).toBe("alpha v1\n");
    await expect(
      readFile(path.join(repository, ".copier/projects/beta.yml"), "utf8"),
    ).resolves.toContain("project_id: beta");

    const repeated = await executeProjectPlan({
      repository,
      mode: "plan",
      plan,
      template: templateSource(template.source),
    });
    expect(repeated.operation).toBe("update");
    expect(repeated.changedPaths).toEqual([]);
    expect(repeated.diff).toBe("");
  });

  it("updates template-owned files and preserves hand-written domain code", async () => {
    const repository = await createRepository();
    const template = await createTemplate();
    const source = templateSource(template.source);
    const initialPlan = makePlan(template.revision);
    await executeProjectPlan({
      repository,
      mode: "create",
      plan: initialPlan,
      template: source,
    });
    const receiptPath = path.join(repository, ".copier/projects/alpha.yml");
    const receiptSource = await readFile(receiptPath, "utf8");
    const tamperedReceipt = parse(receiptSource) as Record<string, unknown>;
    tamperedReceipt._commit = template.revision.slice(0, 7);
    await writeFile(receiptPath, stringify(tamperedReceipt), "utf8");
    await expect(
      executeProjectPlan({
        repository,
        mode: "update",
        plan: initialPlan,
        template: source,
      }),
    ).rejects.toThrow(/not an immutable full Git SHA/);
    await writeFile(receiptPath, receiptSource, "utf8");
    await commit(repository, "Generated alpha");
    await write(
      repository,
      "packages/alpha/domain.ts",
      "export const productOwned = true;\n",
    );
    await commit(repository, "Add product code");

    await write(
      template.root,
      "packages/{{ project_id }}/generated.txt.jinja",
      "{{ message }} from template v2\n",
    );
    const revision = await commitTemplate(template.root, "Template v2");
    const plan = projectPlanSchema.parse({
      ...initialPlan,
      template_revision: revision,
      answers: { project_id: "alpha", message: "alpha v2" },
    });
    const updated = await executeProjectPlan({
      repository,
      mode: "update",
      plan,
      template: source,
    });

    expect(updated.operation).toBe("update");
    expect(
      await readFile(path.join(repository, "packages/alpha/generated.txt"), "utf8"),
    ).toBe("alpha v2 from template v2\n");
    expect(
      await readFile(path.join(repository, "packages/alpha/domain.ts"), "utf8"),
    ).toBe("export const productOwned = true;\n");
  });

  it("rejects unresolved update conflicts without changing the checkout", async () => {
    const repository = await createRepository();
    const template = await createTemplate();
    const source = templateSource(template.source);
    const initialPlan = makePlan(template.revision);
    await executeProjectPlan({
      repository,
      mode: "create",
      plan: initialPlan,
      template: source,
    });
    await commit(repository, "Generated alpha");
    await write(
      repository,
      "packages/alpha/generated.txt",
      "local product edit\n",
    );
    await commit(repository, "Edit generated file locally");
    await write(
      template.root,
      "packages/{{ project_id }}/generated.txt.jinja",
      "template v2 edit\n",
    );
    const revision = await commitTemplate(template.root, "Template v2");
    const plan = projectPlanSchema.parse({
      ...initialPlan,
      template_revision: revision,
    });

    await expect(
      executeProjectPlan({
        repository,
        mode: "update",
        plan,
        template: source,
      }),
    ).rejects.toThrow(/conflict markers/);
    expect(
      await readFile(path.join(repository, "packages/alpha/generated.txt"), "utf8"),
    ).toBe("local product edit\n");
  });

  it("rejects template writes outside declared ownership", async () => {
    const repository = await createRepository();
    const template = await createTemplate({
      extraFile: { path: "README.md.jinja", source: "unauthorized\n" },
    });
    await expect(
      executeProjectPlan({
        repository,
        mode: "dry-run",
        plan: makePlan(template.revision),
        template: templateSource(template.source),
      }),
    ).rejects.toThrow(/outside its declared ownership/);
    await expect(readFile(path.join(repository, "README.md"), "utf8")).rejects.toThrow(
      /ENOENT/,
    );
  });

  it("rejects shared-manifest ownership and explicit operation mismatches", async () => {
    const repository = await createRepository();
    const template = await createTemplate();
    const source = templateSource(template.source);
    const plan = makePlan(template.revision);
    await expect(
      executeProjectPlan({
        repository,
        mode: "update",
        plan,
        template: source,
      }),
    ).rejects.toThrow(/answers file does not exist/);
    await expect(
      executeProjectPlan({
        repository,
        mode: "plan",
        plan: projectPlanSchema.parse({
          ...plan,
          owned_paths: ["ui/content"],
        }),
        template: source,
      }),
    ).rejects.toThrow(/would include shared manifest/);
    await expect(
      executeProjectPlan({
        repository,
        mode: "plan",
        plan,
        template: { ...source, id: "different-template" },
      }),
    ).rejects.toThrow(/Plan selects template/);
  });

  it("rejects rejection files and checks that mutate the candidate", async () => {
    const repository = await createRepository();
    const rejectingTemplate = await createTemplate({
      extraFile: {
        path: "packages/{{ project_id }}/generated.rej.jinja",
        source: "unresolved\n",
      },
    });
    await expect(
      executeProjectPlan({
        repository,
        mode: "plan",
        plan: makePlan(rejectingTemplate.revision),
        template: templateSource(rejectingTemplate.source),
      }),
    ).rejects.toThrow(/rejection file/);

    const mutatingTemplate = await createTemplate();
    await expect(
      executeProjectPlan({
        repository,
        mode: "plan",
        plan: makePlan(mutatingTemplate.revision),
        template: templateSource(mutatingTemplate.source, ["//:mutate"]),
      }),
    ).rejects.toThrow(/check modified the candidate/);
  });
});

describe("CLI", () => {
  it("parses supported commands and path options", () => {
    const parsed = parseCliArguments([
      "plan",
      "profile.yaml",
      "--repository",
      "fixture",
      "--registry",
      "templates.yaml",
    ]);
    expect(parsed.mode).toBe("plan");
    expect(parsed.planPath).toBe(path.resolve("profile.yaml"));
    expect(parsed.repository).toBe(path.resolve("fixture"));
  });

  it("rejects incomplete invocations", () => {
    expect(() => parseCliArguments(["delete", "profile.yaml"])).toThrow(/Usage/);
    expect(() => parseCliArguments(["create", "profile.yaml", "--registry"])).toThrow(
      /Usage/,
    );
  });

  it("runs machine-readable plan and dry-run modes from files", async () => {
    const repository = await createRepository();
    const template = await createTemplate();
    const configuration = await temporaryDirectory("project-generator-config");
    const planPath = path.join(configuration, "plan.yaml");
    const registryPath = path.join(configuration, "registry.yaml");
    await writeFile(planPath, stringify(makePlan(template.revision)), "utf8");
    await writeFile(
      registryPath,
      stringify({
        schema_version: 1,
        templates: [
          {
            id: "monorepo-project",
            source: path.relative(configuration, template.source),
          },
        ],
      }),
      "utf8",
    );
    const output: string[] = [];
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      });
    try {
      await main([
        "plan",
        planPath,
        "--repository",
        repository,
        "--registry",
        registryPath,
      ]);
      expect(JSON.parse(output.join(""))).toMatchObject({
        projectId: "alpha",
        applied: false,
      });
      output.length = 0;
      await main([
        "dry-run",
        planPath,
        "--repository",
        repository,
        "--registry",
        registryPath,
      ]);
      expect(output.join("")).toContain("diff --git");
    } finally {
      stdout.mockRestore();
    }
  });

  it("rejects a plan whose template is not allowlisted", async () => {
    const configuration = await temporaryDirectory("project-generator-config");
    const planPath = path.join(configuration, "plan.yaml");
    const registryPath = path.join(configuration, "registry.yaml");
    await writeFile(planPath, stringify(makePlan("a".repeat(40))), "utf8");
    await writeFile(
      registryPath,
      "schema_version: 1\ntemplates: []\n",
      "utf8",
    );
    await expect(main(["plan", planPath, "--registry", registryPath])).rejects.toThrow(
      /not present in the trusted registry/,
    );
  });
});
