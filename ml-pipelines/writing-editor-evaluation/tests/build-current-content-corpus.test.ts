import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildCurrentContentCorpus } from "../src/build-current-content-corpus";

const temporaryDirectories = new Set<string>();
const paramsFile = path.resolve(import.meta.dirname, "../current-content-params-strict.json");

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "current-content-corpus-"));
  temporaryDirectories.add(directory);
  return directory;
}

function write(repository: string, file: string, content = "Fixture prose.\n"): void {
  const destination = path.join(repository, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}

describe("current content corpus", () => {
  it("captures public and developer Markdown from a worktree or pinned commit", () => {
    const temporary = temporaryDirectory();
    const repository = path.join(temporary, "repository");
    fs.mkdirSync(repository);
    git(repository, "init", "--quiet");
    git(repository, "config", "user.email", "test@example.com");
    git(repository, "config", "user.name", "Test");
    for (const file of [
      "ui/content/blog/post.mdx",
      "ui/content/ideas/concept.mdx",
      "ui/content/initiatives/program.mdx",
      "ui/content/projects/example/index.mdx",
      "ui/content/projects/example/pitch.mdx",
      "ui/content/projects/example/adrs/001-choice.mdx",
      "docs/guide.md",
      "README.md",
      ".claude/ignored.md",
      "vendor/third_party/ignored.md",
    ]) write(repository, file);
    git(repository, "add", ".");
    git(repository, "commit", "--quiet", "-m", "fixture");
    const revision = git(repository, "rev-parse", "HEAD");
    write(repository, "docs/guide.md", "Changed worktree prose.\n");

    const pinnedPublic = buildCurrentContentCorpus({
      repository,
      paramsFile,
      output: path.join(temporary, "pinned-public"),
      outputRoot: temporary,
      audience: "customer",
      revision,
    });
    const pinnedDeveloper = buildCurrentContentCorpus({
      repository,
      paramsFile,
      output: path.join(temporary, "pinned-developer"),
      outputRoot: temporary,
      audience: "developer",
      revision,
    });
    const worktreeDeveloper = buildCurrentContentCorpus({
      repository,
      paramsFile,
      output: path.join(temporary, "worktree-developer"),
      outputRoot: temporary,
      audience: "developer",
    });

    expect(pinnedPublic.entries).toHaveLength(5);
    expect(pinnedPublic.entries.map(({ kind }) => kind)).toEqual([
      "blog", "idea", "initiative", "project-page", "pitch",
    ]);
    expect(pinnedPublic.revision).toBe(revision);
    expect(pinnedDeveloper.entries.map(({ path: file }) => file)).toEqual([
      "README.md",
      "docs/guide.md",
      "ui/content/projects/example/adrs/001-choice.mdx",
    ]);
    expect(worktreeDeveloper.revision).toMatch(/^worktree:/u);
    expect(worktreeDeveloper.datasetId).not.toBe(pinnedDeveloper.datasetId);
    expect(fs.readFileSync(
      path.join(temporary, "worktree-developer/artifacts/developer-doc-docs-guide/source.md"),
      "utf8",
    )).toBe("Changed worktree prose.\n");
  });
});
