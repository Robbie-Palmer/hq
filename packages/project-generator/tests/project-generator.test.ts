import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import {
  parseProjectPlan,
  parseTemplateRegistry,
  projectPlanSchema,
  templateRegistrySchema,
  type ProjectPlan,
  type TemplateSource,
} from "../src/contracts.js";
import {
  executeProjectPlan,
  planProjectAdoption,
} from "../src/engine.js";
import { applySharedManifestEdits } from "../src/manifests.js";
import { runCommand } from "../src/process.js";
import type { ResolvedProjectBlueprint } from "../src/profile.js";

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
  profile?: boolean;
}): Promise<{ root: string; source: string; revision: string }> {
  const root = await temporaryDirectory("project-template");
  await git(root, "init", "--quiet", "--initial-branch=main");
  const copierConfiguration = options?.profile
    ? [
        "_min_copier_version: '9.18.2'",
        "project_id:",
        "  type: str",
        "blueprint:",
        "  type: yaml",
        "",
      ].join("\n")
    : [
        "_min_copier_version: '9.18.2'",
        "project_id:",
        "  type: str",
        "message:",
        "  type: str",
        "",
      ].join("\n");
  await write(root, "copier.yml", copierConfiguration);
  await write(
    root,
    "{{ _copier_conf.answers_file }}.jinja",
    "# Managed by Copier; do not edit.\n{{ _copier_answers | to_nice_yaml -}}\n",
  );
  await write(
    root,
    "packages/{{ project_id }}/generated.txt.jinja",
    options?.profile ? "{{ blueprint.project.name }}\n" : "{{ message }}\n",
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

async function createGitRepositoryFixture(): Promise<string> {
  const root = await temporaryDirectory("git-repository-fixture");
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

function adoptionBlueprint(
  projectId = "alpha",
): ResolvedProjectBlueprint {
  return {
    schema_version: 2,
    profile_schema_version: 1,
    effective_at: "2026-10-21T00:00:00Z",
    project: {
      id: projectId,
      stable_id: `project:${projectId}`,
      name: `${projectId} project`,
      kind: "library",
    },
    components: [
      {
        id: projectId,
        stable_id: `component:${projectId}/${projectId}`,
        name: `${projectId} package`,
        kind: "typescript-package",
        path: `packages/${projectId}`,
        tasks: [
          {
            name: "clean",
            disposition: "not-applicable",
            reason: "The shared workspace owns cleanup.",
          },
        ],
      },
    ],
    repository_paths: {
      copier_answers: `.copier/projects/${projectId}.yml`,
      project_index: `ui/content/projects/${projectId}/index.mdx`,
      architecture_decisions: `ui/content/projects/${projectId}/adrs/{sequence}-{slug}.mdx`,
      product_decisions: `ui/content/projects/${projectId}/pdrs/{sequence}-{slug}.mdx`,
    },
    selections: [],
    catalog: {
      system: {
        id: `system:${projectId}/library`,
        kind: "system",
        project: `project:${projectId}`,
      },
      components: [],
    },
    ownership: {
      owned_paths: [`packages/${projectId}`],
      structural_edits: [],
    },
    nix: { enabled: false },
    opentelemetry: { enabled: false },
    fulfillment_checkpoints: [],
  };
}

function adoptionPlan(revision: string, projectId = "alpha") {
  const blueprint = adoptionBlueprint(projectId);
  const basePlan = makePlan(revision, projectId);
  return {
    blueprint,
    plan: projectPlanSchema.parse({
      ...basePlan,
      answers: { ...basePlan.answers, blueprint },
    }),
  };
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
  it("recognizes packages already registered by pnpm workspace globs", async () => {
    const repository = await createGitRepositoryFixture();
    const workspacePath = path.join(repository, "pnpm-workspace.yaml");
    await writeFile(
      workspacePath,
      "packages:\n  - 'packages/*'\n  - '!packages/private'\n",
      "utf8",
    );

    await expect(
      applySharedManifestEdits(repository, [
        { kind: "pnpm_workspace_package", value: "packages/alpha" },
      ]),
    ).resolves.toEqual([]);
    await expect(
      applySharedManifestEdits(repository, [
        { kind: "pnpm_workspace_package", value: "packages/private" },
      ]),
    ).resolves.toEqual(["pnpm-workspace.yaml"]);
    const workspace = parse(await readFile(workspacePath, "utf8")) as {
      packages: string[];
    };
    expect(workspace.packages).toEqual([
      "packages/*",
      "!packages/private",
      "packages/private",
    ]);
  });

  it("preserves unrelated content and is idempotent", async () => {
    const repository = await createGitRepositoryFixture();
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
    const repository = await createGitRepositoryFixture();
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
    const repository = await createGitRepositoryFixture();
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
    const repository = await createGitRepositoryFixture();
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
    const repository = await createGitRepositoryFixture();
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
    const planned = await executeProjectPlan({
      repository,
      mode: "plan",
      plan,
      template: source,
    });
    await expect(
      executeProjectPlan({
        repository,
        mode: "update",
        plan,
        template: source,
        expectedDiff: `${planned.diff}\nunexpected change`,
      }),
    ).rejects.toThrow(/do not match the reviewed candidate/);
    expect(
      await readFile(path.join(repository, "packages/alpha/generated.txt"), "utf8"),
    ).toBe("alpha v1\n");

    const updated = await executeProjectPlan({
      repository,
      mode: "update",
      plan,
      template: source,
      expectedDiff: planned.diff,
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
    const repository = await createGitRepositoryFixture();
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
    const repository = await createGitRepositoryFixture();
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
    const repository = await createGitRepositoryFixture();
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
    const repository = await createGitRepositoryFixture();
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

describe("existing project adoption planner", () => {
  it("classifies matching template files and preserves local project files", async () => {
    const repository = await createGitRepositoryFixture();
    const template = await createTemplate();
    await write(repository, "packages/alpha/generated.txt", "alpha v1\n");
    await write(
      repository,
      "packages/alpha/domain.ts",
      "export const existingProjectCode = true;\n",
    );
    await commit(repository, "Add existing alpha project");
    const { blueprint, plan } = adoptionPlan(template.revision);

    const result = await planProjectAdoption({
      repository,
      plan,
      template: {
        ...templateSource(template.source),
        revision: template.revision,
      },
      blueprint,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      projectId: "alpha",
      effectiveAt: "2026-10-21T00:00:00Z",
      template: {
        id: "monorepo-project",
        source: template.source,
        revision: template.revision,
      },
      receipt: {
        path: ".copier/projects/alpha.yml",
        classification: "adoptable",
        disposition: "create_after_review",
      },
      readyToAdopt: true,
    });
    expect(result.resolvedBlueprint).toEqual(blueprint);
    expect(result.paths).toContainEqual({
      path: "packages/alpha/generated.txt",
      classification: "matching",
      disposition: "already_matches",
    });
    expect(result.paths).toContainEqual({
      path: "packages/alpha/domain.ts",
      classification: "adoptable",
      disposition: "preserve_local_file",
    });
    expect(result.localExceptions).toEqual({
      overrides: [],
      taskExceptions: [
        {
          componentId: "alpha",
          task: "clean",
          reason: "The shared workspace owns cleanup.",
        },
      ],
      preservedPaths: ["packages/alpha/domain.ts"],
    });
    expect(result.sharedManifestEdits).toHaveLength(
      plan.shared_manifest_edits.length,
    );
    await expect(
      readFile(path.join(repository, ".copier/projects/alpha.yml"), "utf8"),
    ).rejects.toThrow(/ENOENT/);
    expect(await git(repository, "status", "--short")).toBe("");
  });

  it("reports a conflicting template file without overwriting it", async () => {
    const repository = await createGitRepositoryFixture();
    const template = await createTemplate();
    await write(
      repository,
      "packages/alpha/generated.txt",
      "existing product implementation\n",
    );
    await commit(repository, "Add divergent alpha project");

    const { blueprint, plan } = adoptionPlan(template.revision);
    const result = await planProjectAdoption({
      repository,
      plan,
      template: {
        ...templateSource(template.source),
        revision: template.revision,
      },
      blueprint,
    });

    expect(result.readyToAdopt).toBe(false);
    expect(result.paths).toContainEqual({
      path: "packages/alpha/generated.txt",
      classification: "conflicting",
      disposition: "review_conflict",
    });
    await expect(
      readFile(path.join(repository, "packages/alpha/generated.txt"), "utf8"),
    ).resolves.toBe("existing product implementation\n");
  });

  it("reports a conflict when a file blocks a rendered descendant path", async () => {
    const repository = await createGitRepositoryFixture();
    const template = await createTemplate({
      extraFile: {
        path: "packages/{{ project_id }}/nested/generated.txt.jinja",
        source: "nested template output\n",
      },
    });
    await write(
      repository,
      "packages/alpha/nested",
      "existing file blocks the template directory\n",
    );
    await commit(repository, "Add blocking alpha project file");

    const { blueprint, plan } = adoptionPlan(template.revision);
    const result = await planProjectAdoption({
      repository,
      plan,
      template: {
        ...templateSource(template.source),
        revision: template.revision,
      },
      blueprint,
    });

    expect(result.readyToAdopt).toBe(false);
    expect(result.paths).toContainEqual({
      path: "packages/alpha/nested/generated.txt",
      classification: "conflicting",
      disposition: "review_conflict",
    });
    await expect(
      readFile(path.join(repository, "packages/alpha/nested"), "utf8"),
    ).resolves.toBe("existing file blocks the template directory\n");
  });

  it("ignores unrelated dirty-worktree files while planning adoption", async () => {
    const repository = await createGitRepositoryFixture();
    const template = await createTemplate();
    await write(repository, "notes/local.txt", "unrelated work in progress\n");
    const statusBefore = await git(repository, "status", "--short");

    const { blueprint, plan } = adoptionPlan(template.revision);
    const result = await planProjectAdoption({
      repository,
      plan,
      template: {
        ...templateSource(template.source),
        revision: template.revision,
      },
      blueprint,
    });

    expect(result.readyToAdopt).toBe(true);
    expect(result.paths).toContainEqual({
      path: "packages/alpha/generated.txt",
      classification: "adoptable",
      disposition: "add_template_file",
    });
    expect(result.paths.some(({ path: candidate }) => candidate === "notes/local.txt"))
      .toBe(false);
    expect(await git(repository, "status", "--short")).toBe(statusBefore);
  });

  it("rejects template output outside declared ownership", async () => {
    const repository = await createGitRepositoryFixture();
    const template = await createTemplate({
      extraFile: { path: "README.md.jinja", source: "template readme\n" },
    });

    const { blueprint, plan } = adoptionPlan(template.revision);
    const result = await planProjectAdoption({
      repository,
      plan,
      template: {
        ...templateSource(template.source),
        revision: template.revision,
      },
      blueprint,
    });

    expect(result.readyToAdopt).toBe(false);
    expect(result.paths).toContainEqual({
      path: "README.md",
      classification: "outside_ownership",
      disposition: "reject_template_file",
    });
    await expect(readFile(path.join(repository, "README.md"), "utf8"))
      .rejects.toThrow(/ENOENT/);
  });
});

describe("CLI", () => {
  it("derives commands, positional arguments, and options from the router schemas", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dependencies = {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    };

    expect(await runCli(["--help"], dependencies)).toBe(0);
    expect(stdout.join("")).toContain("dry-run");
    expect(stdout.join("")).toContain("profile-adoption-plan");
    expect(stdout.join("")).toContain("profile-reconcile");
    expect(stdout.join("")).toContain("profile-reconcile-apply");
    expect(stdout.join("")).toContain("profile-dry-run");
    expect(stdout.join("")).toContain("profile-resolve");
    stdout.length = 0;

    expect(await runCli(["create", "--help"], dependencies)).toBe(0);
    const help = stdout.join("");
    expect(help).toContain("Create a Copier-managed project");
    expect(help).toContain("Project plan YAML path");
    expect(help).toContain("--repository [string]");
    expect(help).toContain("--registry [string]");
    expect(stderr).toEqual([]);

    stdout.length = 0;
    expect(await runCli(["profile-update", "--help"], dependencies)).toBe(0);
    expect(stdout.join("")).toContain("--reviewed-plan <string>");
  });

  it("resolves, previews, and applies a versioned project profile", async () => {
    const repository = await createGitRepositoryFixture();
    const template = await createTemplate({ profile: true });
    const configuration = await temporaryDirectory("project-profile-config");
    const contractsDirectory = path.join(configuration, "contracts");
    const productionContracts = new URL(
      "../../../ui/content/projects/personal-engineering-platform/",
      import.meta.url,
    );
    const [nix, opentelemetry] = await Promise.all([
      readFile(new URL("nix-flake-contract.yaml", productionContracts), "utf8"),
      readFile(
        new URL("opentelemetry-contract.yaml", productionContracts),
        "utf8",
      ),
    ]);
    await write(
      contractsDirectory,
      "repository-layout.yaml",
      stringify({
        schema_version: 1,
        project_kinds: [
          {
            id: "library",
            description: "Reusable code.",
            task_profile: "standard",
          },
        ],
        projects: [],
        component_kinds: [
          {
            id: "typescript-package",
            description: "TypeScript package.",
            directory: "packages/{component}",
            task_ownership: "generated",
          },
        ],
        task_contract: {
          id: "standard",
          required: [
            "install",
            "format",
            "lint",
            "typecheck-or-compile",
            "test",
            "build",
            "clean",
          ],
        },
        knowledge_graph: {
          project_index: "ui/content/projects/{project}/index.mdx",
          architecture_decisions:
            "ui/content/projects/{project}/adrs/{sequence}-{slug}.mdx",
          product_decisions:
            "ui/content/projects/{project}/pdrs/{sequence}-{slug}.mdx",
        },
        shared_manifests: [],
        workspace_policy: {
          node_workspace: "pnpm-workspace.yaml",
          node_lockfile: "pnpm-lock.yaml",
          standalone_node_roots: [],
          approved_npm_lockfiles: [],
          local_mise_roots: [],
        },
      }),
    );
    await write(
      contractsDirectory,
      "platform.yaml",
      stringify({
        schema_version: 1,
        project: "personal-engineering-platform",
        catalog: { records: [] },
        layers: [{ slug: "base" }],
        slots: [{ slug: "project.task-runner" }],
        policies: [
          {
            id: "base-task-runner",
            layer: "base",
            slot: "project.task-runner",
            mode: "required",
            decision: "personal-engineering-platform:001-mise",
            effective_from: "2026-01-01T00:00:00Z",
          },
        ],
        selections: [
          {
            id: "project-task-runner-mise",
            slot: "project.task-runner",
            technology: "mise",
            status: "Accepted",
            decision: "personal-engineering-platform:001-mise",
            effective_from: "2026-01-01T00:00:00Z",
            configuration_requirements: [{ name: "MISE_CONFIG" }],
          },
        ],
      }),
    );
    await write(contractsDirectory, "nix-flake-contract.yaml", nix);
    await write(
      contractsDirectory,
      "opentelemetry-contract.yaml",
      opentelemetry,
    );
    const baseProfile = {
      schema_version: 1,
      project: { id: "alpha", name: "Alpha package", kind: "library" },
      components: [
        { id: "alpha", name: "Alpha package", kind: "typescript-package" },
      ],
      layers: [{ layer: "base" }],
      nix: { boundary: "none" },
      opentelemetry: { enabled: false },
    };
    await write(configuration, "profile.yaml", stringify(baseProfile));
    await write(
      configuration,
      "registry.yaml",
      stringify({
        schema_version: 1,
        templates: [
          {
            id: "monorepo-project",
            source: template.source,
            revision: template.revision,
            checks: ["//:fixture"],
          },
        ],
      }),
    );
    const output: string[] = [];
    const errors: string[] = [];
    const dependencies = {
      workingDirectory: configuration,
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
    };
    const args = [
      "profile.yaml",
      "--effective-at",
      "2026-10-21T00:00:00Z",
      "--repository",
      repository,
      "--registry",
      "registry.yaml",
      "--contracts",
      "contracts",
    ];

    expect(await runCli(["profile-adoption-plan", ...args], dependencies)).toBe(
      0,
    );
    expect(JSON.parse(output.join(""))).toMatchObject({
      projectId: "alpha",
      effectiveAt: "2026-10-21T00:00:00Z",
      readyToAdopt: true,
      template: {
        id: "monorepo-project",
        revision: template.revision,
      },
      resolvedBlueprint: {
        project: { id: "alpha" },
      },
      localExceptions: {
        overrides: [],
        taskExceptions: [],
        preservedPaths: [],
      },
    });
    output.length = 0;
    expect(await runCli(["profile-resolve", ...args], dependencies)).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      schema_version: 2,
      effective_at: "2026-10-21T00:00:00Z",
      project: { id: "alpha" },
    });
    output.length = 0;
    expect(await runCli(["profile-plan", ...args], dependencies)).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      projectId: "alpha",
      applied: false,
    });
    output.length = 0;
    expect(await runCli(["profile-dry-run", ...args], dependencies)).toBe(0);
    expect(output.join("")).toContain("Alpha package");
    output.length = 0;
    expect(await runCli(["profile-create", ...args], dependencies)).toBe(0);
    await expect(
      readFile(path.join(repository, "packages/alpha/generated.txt"), "utf8"),
    ).resolves.toBe("Alpha package\n");

    const receiptPath = path.join(repository, ".copier/projects/alpha.yml");
    const receiptSource = await readFile(receiptPath, "utf8");
    const receiptWithoutEvidence = parse(receiptSource) as {
      blueprint: {
        fulfillment_checkpoints: {
          evidence: string[];
          status: string;
        }[];
      };
    };
    const checkpointWithoutEvidence =
      receiptWithoutEvidence.blueprint.fulfillment_checkpoints[0];
    if (!checkpointWithoutEvidence) throw new Error("Missing fixture checkpoint");
    checkpointWithoutEvidence.status = "verified";
    await writeFile(receiptPath, stringify(receiptWithoutEvidence), "utf8");
    const invalidReceiptErrors: string[] = [];
    expect(
      await runCli(
        [
          "profile-reconcile",
          ...args.map((argument) =>
            argument === "2026-10-21T00:00:00Z"
              ? "2026-10-22T00:00:00Z"
              : argument,
          ),
        ],
        {
          ...dependencies,
          stderr: (text: string) => invalidReceiptErrors.push(text),
        },
      ),
    ).toBe(1);
    expect(invalidReceiptErrors.join(" ")).toContain(
      "must contain at least one item when a checkpoint is verified",
    );
    await writeFile(receiptPath, receiptSource, "utf8");

    await write(
      repository,
      "packages/alpha/domain.ts",
      "export const productCode = 'preserved';\n",
    );
    await commit(repository, "Create alpha from the old blueprint");
    await write(
      contractsDirectory,
      "platform.yaml",
      stringify({
        schema_version: 1,
        project: "personal-engineering-platform",
        catalog: { records: [] },
        layers: [{ slug: "base" }],
        slots: [{ slug: "project.task-runner" }],
        policies: [
          {
            id: "base-task-runner-old",
            layer: "base",
            slot: "project.task-runner",
            mode: "required",
            decision: "personal-engineering-platform:001-mise",
            effective_from: "2026-01-01T00:00:00Z",
            effective_until: "2026-11-01T00:00:00Z",
          },
          {
            id: "base-task-runner-current",
            layer: "base",
            slot: "project.task-runner",
            mode: "required",
            decision: "personal-engineering-platform:002-current-runner",
            effective_from: "2026-11-01T00:00:00Z",
          },
        ],
        selections: [
          {
            id: "project-task-runner-mise",
            slot: "project.task-runner",
            technology: "mise",
            status: "Accepted",
            decision: "personal-engineering-platform:001-mise",
            effective_from: "2026-01-01T00:00:00Z",
            effective_until: "2026-11-01T00:00:00Z",
          },
          {
            id: "project-task-runner-current",
            slot: "project.task-runner",
            technology: "current-runner",
            status: "Accepted",
            decision: "personal-engineering-platform:002-current-runner",
            effective_from: "2026-11-01T00:00:00Z",
            configuration_requirements: [{ name: "CURRENT_RUNNER_TOKEN" }],
            state_requirements: [{ name: "Runner cache" }],
          },
        ],
      }),
    );
    await write(
      configuration,
      "profile.yaml",
      stringify({
        ...baseProfile,
        checkpoint_fulfillment: [
          {
            checkpoint:
              "project-task-runner-current-configuration-current-runner-token",
            status: "verified",
            evidence: ["ci://runs/current-runner-token"],
          },
        ],
      }),
    );
    const reconciliationArgs = args.map((argument) =>
      argument === "2026-10-21T00:00:00Z"
        ? "2026-11-02T00:00:00Z"
        : argument,
    );
    output.length = 0;
    const reconciliationExitCode = await runCli(
      ["profile-reconcile", ...reconciliationArgs],
      dependencies,
    );
    expect(errors).toEqual([]);
    expect(reconciliationExitCode).toBe(0);
    const reconciliation = JSON.parse(output.join("")) as {
      status: string;
      planDigest: string;
      policyChanges: { kind: string }[];
      defaultChanges: { kind: string }[];
      actions: {
        manualDecisions: { kind: string; summary: string }[];
      };
      candidate: { checks: unknown[] };
    };
    expect(reconciliation).toMatchObject({
      status: "ready",
      policyChanges: [{ kind: "replaced" }],
      defaultChanges: [{ kind: "replaced" }],
      actions: {
        manualDecisions: [
          {
            kind: "fulfillment_checkpoint",
            summary:
              "Provision Runner cache for project-task-runner-current",
          },
        ],
      },
      candidate: {
        checks: [{ task: "//:fixture", status: "passed" }],
      },
    });
    const reviewedPlan = path.join(configuration, "reviewed-plan.json");
    await writeFile(reviewedPlan, JSON.stringify(reconciliation), "utf8");
    const stalePlan = path.join(configuration, "stale-plan.json");
    await writeFile(
      stalePlan,
      JSON.stringify({ ...reconciliation, planDigest: "0".repeat(64) }),
      "utf8",
    );
    const applyErrors: string[] = [];
    expect(
      await runCli(
        [
          "profile-reconcile-apply",
          ...reconciliationArgs,
          "--reviewed-plan",
          stalePlan,
        ],
        {
          ...dependencies,
          stderr: (text: string) => applyErrors.push(text),
        },
      ),
    ).toBe(1);
    expect(applyErrors.join(" ")).toContain(
      "Reviewed reconciliation plan does not match",
    );
    output.length = 0;
    expect(
      await runCli(
        [
          "profile-reconcile-apply",
          ...reconciliationArgs,
          "--reviewed-plan",
          reviewedPlan,
        ],
        dependencies,
      ),
    ).toBe(0);
    const receipt = parse(
      await readFile(path.join(repository, ".copier/projects/alpha.yml"), "utf8"),
    ) as { blueprint: { effective_at: string; selections: { id: string }[] } };
    expect(receipt.blueprint.selections).toContainEqual({
      decision: "personal-engineering-platform:002-current-runner",
      id: "project-task-runner-current",
      kind: "technology",
      layer: "base",
      slot: "project.task-runner",
      source: "default",
      value: "current-runner",
    });
    await expect(
      readFile(path.join(repository, "packages/alpha/domain.ts"), "utf8"),
    ).resolves.toBe("export const productCode = 'preserved';\n");

    await commit(repository, "Reconcile alpha to current defaults");
    const statusBeforeBlockedPlans = await git(repository, "status", "--short");
    await write(
      configuration,
      "profile.yaml",
      stringify({
        ...baseProfile,
        reconciliation: {
          mode: "frozen",
          frozen_at: "2026-11-02T00:00:00Z",
          reason: "The completed fixture keeps its last accepted stack.",
        },
      }),
    );
    output.length = 0;
    expect(
      await runCli(
        [
          "profile-reconcile",
          ...reconciliationArgs.map((argument) =>
            argument === "2026-11-02T00:00:00Z"
              ? "2026-12-01T00:00:00Z"
              : argument,
          ),
        ],
        dependencies,
      ),
    ).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "frozen",
      candidate: null,
      blockedReason: "The completed fixture keeps its last accepted stack.",
    });

    await write(
      configuration,
      "profile.yaml",
      stringify({
        ...baseProfile,
        reconciliation: {
          mode: "tracking",
          defer: {
            effective_at: "2027-01-01T00:00:00.0Z",
            reason: "Wait for the current migration window to close.",
          },
        },
      }),
    );
    output.length = 0;
    expect(
      await runCli(
        [
          "profile-reconcile",
          ...reconciliationArgs.map((argument) =>
            argument === "2026-11-02T00:00:00Z"
              ? "2027-01-01T00:00:00Z"
              : argument,
          ),
        ],
        dependencies,
      ),
    ).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "deferred",
      candidate: null,
      deferral: {
        effectiveAt: "2027-01-01T00:00:00.0Z",
        reason: "Wait for the current migration window to close.",
      },
    });
    expect(await git(repository, "status", "--short")).toBe(
      statusBeforeBlockedPlans,
    );
  });

  it("rejects unknown commands and missing option values", async () => {
    const stderr: string[] = [];
    const dependencies = {
      stdout: () => undefined,
      stderr: (text: string) => stderr.push(text),
    };

    expect(await runCli(["delete", "profile.yaml"], dependencies)).toBe(1);
    expect(await runCli(["create", "profile.yaml", "--registry"], dependencies)).toBe(
      1,
    );
    expect(stderr.join(" ")).toMatch(/unknown command|argument missing/iu);
  });

  it("runs machine-readable plan and dry-run modes from files", async () => {
    const repository = await createGitRepositoryFixture();
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
    const dependencies = {
      workingDirectory: configuration,
      stdout: (text: string) => output.push(text),
      stderr: () => undefined,
    };
    const args = [
      "plan.yaml",
      "--repository",
      path.relative(configuration, repository),
      "--registry",
      path.basename(registryPath),
    ];

    expect(await runCli(["plan", ...args], dependencies)).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      projectId: "alpha",
      applied: false,
    });
    output.length = 0;
    expect(await runCli(["dry-run", ...args], dependencies)).toBe(0);
    expect(output.join("")).toContain("diff --git");
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
    const stderr: string[] = [];
    expect(
      await runCli(["plan", planPath, "--registry", registryPath], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      }),
    ).toBe(1);
    expect(stderr.join(" ")).toContain(
      "not present in the trusted registry",
    );
  });
});
