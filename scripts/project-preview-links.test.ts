import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectProfile } from "../packages/project-generator/src/profile.js";
import {
  loadProjectPreviewLinks,
  projectPreviewLinksFromProfiles,
  writeProjectPreviewLinks,
} from "./project-preview-links.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function profile(
  id: string,
  name: string,
  mountPath: string,
): ReturnType<typeof parseProjectProfile> {
  return parseProjectProfile(`
schema_version: 1
project:
  id: ${id}
  name: ${name}
  kind: application
components:
  - id: web
    name: ${name}
    kind: project-ui
    mount_path: ${mountPath}
layers:
  - layer: base
nix:
  boundary: none
opentelemetry:
  enabled: false
`);
}

describe("project preview links", () => {
  it("loads project UI links from the repository profiles", async () => {
    await expect(loadProjectPreviewLinks(repositoryRoot)).resolves.toEqual([
      { name: "Asset Tracker", path: "/assettracker" },
      { name: "Wedding planner", path: "/wedding-planner" },
    ]);
  });

  it("sorts links by display name", () => {
    expect(
      projectPreviewLinksFromProfiles([
        profile("zulu", "Zulu", "/zulu"),
        profile("alpha", "Alpha", "/alpha"),
      ]),
    ).toEqual([
      { name: "Alpha", path: "/alpha" },
      { name: "Zulu", path: "/zulu" },
    ]);
  });

  it("rejects duplicate mount paths across profiles", () => {
    expect(() =>
      projectPreviewLinksFromProfiles([
        profile("first", "First", "/shared"),
        profile("second", "Second", "/shared"),
      ]),
    ).toThrow("Project profiles define duplicate preview path '/shared'");
  });

  it("rejects a malformed project UI without a mount path", () => {
    const malformed = profile("malformed", "Malformed", "/malformed");
    delete malformed.components[0]?.mount_path;

    expect(() => projectPreviewLinksFromProfiles([malformed])).toThrow(
      "Project UI component 'web' is missing a mount path",
    );
  });

  it("writes JSON for local use", async () => {
    const output: string[] = [];

    await writeProjectPreviewLinks(repositoryRoot, undefined, {
      write: (value) => output.push(value),
    });

    expect(output).toEqual([
      '[{"name":"Asset Tracker","path":"/assettracker"},{"name":"Wedding planner","path":"/wedding-planner"}]\n',
    ]);
  });

  it("writes the GitHub Actions step output", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "project-preview-links-"),
    );
    const githubOutput = path.join(temporaryDirectory, "github-output");

    try {
      await writeProjectPreviewLinks(
        repositoryRoot,
        githubOutput,
        process.stdout,
      );

      await expect(readFile(githubOutput, "utf8")).resolves.toBe(
        'links=[{"name":"Asset Tracker","path":"/assettracker"},{"name":"Wedding planner","path":"/wedding-planner"}]\n',
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true });
    }
  });
});
