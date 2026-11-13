import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/process.js";
import {
  parseProjectProfile,
  parseProjectProfileContracts,
  resolveProjectProfile,
  type ProjectProfile,
} from "../src/profile.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const platformRoot = path.join(
  repositoryRoot,
  "ui/content/projects/personal-engineering-platform",
);
const profilePath = path.join(
  repositoryRoot,
  "packages/project-generator/tests/fixtures/stateful-operations-profile.yaml",
);
const temporaryRoots: string[] = [];
const executeFile = promisify(execFile);

async function runOperationScript(
  operationsRoot: string,
  args: readonly string[],
  options: {
    readonly allowFailure?: boolean;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
) {
  try {
    const { stdout, stderr } = await executeFile("./operate.sh", args, {
      cwd: operationsRoot,
      encoding: "utf8",
      env: options.env ?? process.env,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    if (!options.allowFailure) throw error;
    const failure = error as {
      readonly code?: number;
      readonly stderr?: string;
      readonly stdout?: string;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

async function fixture() {
  const [profile, layout, platform, nix, opentelemetry, deploymentMaturity] =
    await Promise.all([
      readFile(profilePath, "utf8"),
      readFile(path.join(platformRoot, "repository-layout.yaml"), "utf8"),
      readFile(path.join(platformRoot, "platform.yaml"), "utf8"),
      readFile(path.join(platformRoot, "nix-flake-contract.yaml"), "utf8"),
      readFile(path.join(platformRoot, "opentelemetry-contract.yaml"), "utf8"),
      readFile(path.join(platformRoot, "deployment-maturity.yaml"), "utf8"),
    ]);
  return {
    profile: parseProjectProfile(profile),
    contracts: parseProjectProfileContracts({
      layout,
      platform,
      nix,
      opentelemetry,
      deploymentMaturity,
    }),
  };
}

describe("stateful project operations", () => {
  it("rejects inline shell syntax in project operation hooks", async () => {
    const source = await readFile(profilePath, "utf8");
    const injected = source.replace(
      "mise //workers/example-api:preview:provision",
      "mise //workers/example-api:preview:provision; curl https://example.invalid",
    );

    expect(() => parseProjectProfile(injected)).toThrow(
      /without inline shell syntax/,
    );
  });

  it("resolves selected operational capabilities and redacted handoffs", async () => {
    const { profile, contracts } = await fixture();
    const blueprint = resolveProjectProfile(
      profile,
      contracts,
      "2026-11-06T00:00:00Z",
    );

    expect(blueprint.rollout.stateful_operations).toMatchObject({
      preview: {
        secret_config_ref:
          "doppler://example-stateful-service/prv_ci",
        seed_synthetic: "mise //workers/example-api:db:seed:preview",
      },
      production: {
        plan_secret_config_ref:
          "doppler://example-stateful-service/prd_plan",
        apply_secret_config_ref:
          "doppler://example-stateful-service/prd_apply",
      },
      backup: {
        schedule: "17 3 * * 0",
      },
      alerting: {
        responder: "Example service owner",
      },
    });
    const selectedSlots = new Set(
      blueprint.selections.map(({ slot }) => slot),
    );
    expect(selectedSlots.has("database.preview-isolation")).toBe(true);
    expect(selectedSlots.has("database.backup-restore")).toBe(true);
    expect(selectedSlots.has("observability.alert-evaluation")).toBe(true);
  });

  it("renders scripts, workflow callers, runbooks, and evidence contracts", async () => {
    const { profile, contracts } = await fixture();
    const blueprint = resolveProjectProfile(
      profile,
      contracts,
      "2026-11-06T00:00:00Z",
    );
    const root = await mkdtemp(
      path.join(tmpdir(), "stateful-operations-template-"),
    );
    temporaryRoots.push(root);
    const dataPath = path.join(root, "answers.yaml");
    const destination = path.join(root, "rendered");
    await writeFile(
      dataPath,
      stringify({ project_id: blueprint.project.id, blueprint }),
      "utf8",
    );
    await runCommand("copier", [
      "copy",
      "--quiet",
      "--defaults",
      "--skip-tasks",
      "--data-file",
      dataPath,
      repositoryRoot,
      destination,
    ]);

    const operationsRoot = path.join(
      destination,
      "infra/example-stateful-service/operations",
    );
    const [
      manifestSource,
      script,
      runbook,
      previewWorkflow,
      productionWorkflow,
      backupWorkflow,
      alertWorkflow,
      schemaSource,
    ] =
      await Promise.all([
        readFile(path.join(operationsRoot, "generated-operations.yaml"), "utf8"),
        readFile(path.join(operationsRoot, "operate.sh"), "utf8"),
        readFile(path.join(operationsRoot, "README.md"), "utf8"),
        readFile(
          path.join(operationsRoot, "workflows/preview-caller.yml"),
          "utf8",
        ),
        readFile(
          path.join(operationsRoot, "workflows/production-caller.yml"),
          "utf8",
        ),
        readFile(
          path.join(operationsRoot, "workflows/backup-caller.yml"),
          "utf8",
        ),
        readFile(
          path.join(operationsRoot, "workflows/alert-caller.yml"),
          "utf8",
        ),
        readFile(
          path.join(operationsRoot, "rollout-evidence.schema.json"),
          "utf8",
        ),
      ]);
    const manifest = parse(manifestSource) as {
      data_classification: string;
      secret_handoff_checkpoints: Array<{
        reference: string;
        status: string;
      }>;
    };
    const evidenceSchema = JSON.parse(schemaSource) as {
      properties: { action: { enum: string[] } };
    };

    expect(manifest.data_classification).toBe("synthetic-only");
    expect(manifest.secret_handoff_checkpoints).toHaveLength(6);
    expect(
      manifest.secret_handoff_checkpoints.every(
        ({ reference, status }) =>
          reference.startsWith("doppler://") && status === "pending",
      ),
    ).toBe(true);
    expect(script).toContain('require_mutation_token "production:$EXPECTED_PLAN_SHA256"');
    expect(script).toContain("RESTORE_TARGET_CLASS must be scratch.");
    expect(script).toContain("production.tfplan.age");
    expect(script).toContain("unset TERRAFORM_PLAN_AGE_IDENTITY");
    expect(script).toContain('mkdir -p "$evidence_dir" || return');
    expect(script).toContain('sensitive_temp_files+=("$plan_file")');
    expect(script.match(/run_step "terraform-init"/g)).toHaveLength(2);
    expect(runbook).toContain("fresh Neon branch");
    expect(runbook).toContain("does not trigger an automatic rollback");
    expect(previewWorkflow).toContain("github.event.pull_request.head.sha");
    expect(previewWorkflow).not.toContain("recipe");
    expect(parse(previewWorkflow)).toBeTypeOf("object");
    expect(parse(productionWorkflow)).toBeTypeOf("object");
    expect(parse(backupWorkflow)).toBeTypeOf("object");
    expect(parse(alertWorkflow)).toBeTypeOf("object");
    expect(productionWorkflow).toContain("production-rollback");
    expect(backupWorkflow).toContain("restore_drill_id");
    expect(evidenceSchema.properties.action.enum).toContain("restore");
    await chmod(path.join(operationsRoot, "operate.sh"), 0o755);
    const refused = await runOperationScript(
      operationsRoot,
      ["preview-up", "42"],
      {
        allowFailure: true,
        env: {
          ...process.env,
          OPERATIONS_GITHUB_ENVIRONMENT: "example-preview",
          OPERATIONS_SECRET_CONFIG_REF:
            "doppler://example-stateful-service/prv_ci",
          OPERATIONS_MUTATION_TOKEN: "preview:41",
        },
      },
    );
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(
      "Refusing provider mutation without OPERATIONS_MUTATION_TOKEN=preview:42",
    );

    const fakeBin = path.join(root, "fake-bin");
    const fakeMise = path.join(fakeBin, "mise");
    await mkdir(fakeBin);
    await writeFile(fakeMise, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeMise, 0o755);
    await runCommand("git", ["init", "--quiet", "--initial-branch=main"], {
      cwd: destination,
    });
    await runCommand("git", ["add", "--all"], { cwd: destination });
    await runCommand(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Fixture",
      ],
      { cwd: destination },
    );
    const completed = await runOperationScript(
      operationsRoot,
      ["preview-up", "42"],
      {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          OPERATIONS_GITHUB_ENVIRONMENT: "example-preview",
          OPERATIONS_SECRET_CONFIG_REF:
            "doppler://example-stateful-service/prv_ci",
          OPERATIONS_MUTATION_TOKEN: "preview:42",
        },
      },
    );
    expect(completed.stdout).toContain("Rollout evidence:");
    const evidenceFiles = (
      await readdir(path.join(operationsRoot, "evidence"))
    ).filter((file) => file.endsWith(".json"));
    expect(evidenceFiles).toHaveLength(1);
    const evidence = JSON.parse(
      await readFile(
        path.join(operationsRoot, "evidence", evidenceFiles[0] ?? ""),
        "utf8",
      ),
    ) as {
      project: string;
      action: string;
      outcome: string;
      subject: string;
      steps: Array<{ id: string; outcome: string }>;
    };
    expect(evidence).toMatchObject({
      project: "project:example-stateful-service",
      action: "preview-up",
      outcome: "passed",
      subject: "pr-42",
    });
    expect(evidence.steps.map(({ id }) => id)).toEqual([
      "preview-provision",
      "preview-migrate",
      "preview-seed-synthetic",
      "preview-deploy",
      "preview-smoke-authenticated",
      "preview-smoke-telemetry",
    ]);
    expect(evidence.steps.every(({ outcome }) => outcome === "passed")).toBe(
      true,
    );
  });

  it("compiles infrastructure for a project-owned stateful Terraform root", async () => {
    const { profile, contracts } = await fixture();
    const projectOwned = structuredClone(profile) as ProjectProfile;
    projectOwned.components = projectOwned.components.map((component) =>
      component.kind === "terraform-root"
        ? { ...component, template_ownership: "project" }
        : component,
    );
    const blueprint = resolveProjectProfile(
      projectOwned,
      contracts,
      "2026-11-06T00:00:00Z",
    );
    const root = await mkdtemp(path.join(tmpdir(), "stateful-project-root-"));
    temporaryRoots.push(root);
    const dataPath = path.join(root, "answers.yaml");
    const destination = path.join(root, "rendered");
    await writeFile(
      dataPath,
      stringify({ project_id: blueprint.project.id, blueprint }),
      "utf8",
    );

    await runCommand("copier", [
      "copy",
      "--quiet",
      "--defaults",
      "--skip-tasks",
      "--data-file",
      dataPath,
      repositoryRoot,
      destination,
    ]);

    const terraform = await readFile(
      path.join(destination, "infra/example-stateful-service/generated-project.tf"),
      "utf8",
    );
    expect(terraform).toContain('module "cloudflare_worker"');
    expect(terraform).toContain('module "cloudflare_access"');
    expect(terraform).toContain('module "neon"');
    expect(terraform).toContain('module "cloudflare_r2"');
  });

  it("requires exactly one Terraform root for stateful operations", async () => {
    const { profile, contracts } = await fixture();
    const invalid = structuredClone(profile) as ProjectProfile;
    invalid.components = invalid.components.filter(
      ({ kind }) => kind !== "terraform-root",
    );

    expect(() =>
      resolveProjectProfile(invalid, contracts, "2026-11-06T00:00:00Z"),
    ).toThrow(/require one terraform-root component, found 0/);
  });

  it("rejects stateful operations with a missing required capability", async () => {
    const { profile, contracts } = await fixture();
    const invalid = structuredClone(profile) as ProjectProfile;
    invalid.layers = invalid.layers.map((layer) => ({
      ...layer,
      slots: layer.slots.filter((slot) => slot !== "security.preview-access"),
    }));

    expect(() =>
      resolveProjectProfile(invalid, contracts, "2026-11-06T00:00:00Z"),
    ).toThrow(/require selected capabilities: security.preview-access/);
  });

  it("rejects selected backup capability without matching operations", async () => {
    const { profile, contracts } = await fixture();
    const invalid = structuredClone(profile) as ProjectProfile;
    if (!invalid.rollout.stateful_operations) {
      throw new Error("Fixture is missing stateful operations");
    }
    delete invalid.rollout.stateful_operations.backup;

    expect(() =>
      resolveProjectProfile(invalid, contracts, "2026-11-06T00:00:00Z"),
    ).toThrow(/backup operations must be declared/);
  });

  it("rejects selected alert capability without matching operations", async () => {
    const { profile, contracts } = await fixture();
    const invalid = structuredClone(profile) as ProjectProfile;
    if (!invalid.rollout.stateful_operations) {
      throw new Error("Fixture is missing stateful operations");
    }
    delete invalid.rollout.stateful_operations.alerting;

    expect(() =>
      resolveProjectProfile(invalid, contracts, "2026-11-06T00:00:00Z"),
    ).toThrow(/alert operations must be declared/);
  });
});
