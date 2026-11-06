import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
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

async function renderTerraform(componentKind: "project-ui" | "ui") {
  const root = await mkdtemp(path.join(tmpdir(), "shared-host-template-"));
  temporaryRoots.push(root);
  const template = path.join(root, "template");
  const destination = path.join(root, "output");
  await mkdir(template, { recursive: true });
  await cp(
    path.join(repositoryRoot, "copier.yml"),
    path.join(template, "copier.yml"),
  );
  await cp(
    path.join(repositoryRoot, "copier-templates"),
    path.join(template, "copier-templates"),
    { recursive: true },
  );

  const blueprint = {
    project: {
      id: "shared-host-test",
      stable_id: "project:shared-host-test",
    },
    components: [
      {
        id: "web",
        kind: componentKind,
        name: "Web",
        path:
          componentKind === "ui"
            ? "ui"
            : "ui/app/_projects/shared-host-test",
      },
      {
        id: "shared-host-test",
        kind: "terraform-root",
        name: "Infrastructure",
        path: "infra/shared-host-test",
        template_ownership: "structure-only",
      },
    ],
    selections: [
      { slot: "web-app.host", value: "cloudflare-pages" },
      { slot: "security.preview-access", value: "cloudflare-access" },
      { slot: "backend-api.runtime", value: "cloudflare-workers" },
      { slot: "database.relational-host", value: "neon" },
    ],
    rollout: { operational_checks: [], migration_checkpoints: [] },
  };
  const dataFile = path.join(root, "data.yaml");
  await writeFile(
    dataFile,
    stringify({ project_id: "shared-host-test", blueprint }),
    "utf8",
  );
  await runCommand("copier", [
    "copy",
    "--defaults",
    "--trust",
    "--data-file",
    dataFile,
    template,
    destination,
  ]);
  return readFile(
    path.join(destination, "infra/shared-host-test/generated-project.tf"),
    "utf8",
  );
}

describe("shared frontend host Terraform generation", () => {
  it("keeps shared Pages unclaimed while protecting a project Worker", async () => {
    const terraform = await renderTerraform("project-ui");

    expect(terraform).not.toContain('module "cloudflare_pages"');
    expect(terraform).toContain('module "cloudflare_access"');
    expect(terraform).toContain('module "cloudflare_worker"');
    expect(terraform).toContain('module "neon"');
    expect(terraform).not.toContain('"web-app.host"');
    expect(terraform).toContain('"security.preview-access"');
  });

  it("keeps Pages and Access for a project-owned frontend host", async () => {
    const terraform = await renderTerraform("ui");

    expect(terraform).toContain('module "cloudflare_pages"');
    expect(terraform).toContain('module "cloudflare_access"');
    expect(terraform).toContain('"web-app.host"');
    expect(terraform).toContain('"security.preview-access"');
  });
});
