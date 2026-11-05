import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const fetchPreview = path.join(repositoryRoot, "scripts/fetch-preview.sh");

describe("fetch-preview", () => {
  let fixtureRoot: string;
  let curlArguments: string;
  let curlInput: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "fetch-preview-"));
    curlArguments = path.join(fixtureRoot, "curl-arguments");
    curlInput = path.join(fixtureRoot, "curl-input");
    const curl = path.join(fixtureRoot, "curl");
    await writeFile(
      curl,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "curl 8.0.0 test"
  exit 0
fi
printf '%s\\n' "$@" > "$CAPTURE_CURL_ARGUMENTS"
cat > "$CAPTURE_CURL_INPUT"
printf 'preview body'
`,
      "utf8",
    );
    await chmod(curl, 0o755);
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  function run(url: string, environment: NodeJS.ProcessEnv = {}) {
    return spawnSync("bash", [fetchPreview, url], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_CURL_ARGUMENTS: curlArguments,
        CAPTURE_CURL_INPUT: curlInput,
        CF_ACCESS_CLIENT_ID: "test-client-id",
        CF_ACCESS_CLIENT_SECRET: "test-client-secret",
        CLOUDFLARE_PAGES_HOST: "example.pages.dev",
        PATH: `${fixtureRoot}:${process.env.PATH ?? ""}`,
        ...environment,
      },
    });
  }

  it("sends credentials through stdin only to the exact canonical origin", async () => {
    const url = "https://pr-123.example.pages.dev/projects.md?view=agent";
    const result = run(url);

    expect(result).toMatchObject({ status: 0, stderr: "", stdout: "preview body" });
    await expect(readFile(curlInput, "utf8")).resolves.toBe(
      "CF-Access-Client-Id: test-client-id\n" +
        "CF-Access-Client-Secret: test-client-secret\n",
    );
    await expect(readFile(curlArguments, "utf8")).resolves.toBe(
      [
        "--disable",
        "--connect-timeout",
        "10",
        "--fail-with-body",
        "--header",
        "@-",
        "--location",
        "--max-redirs",
        "0",
        "--max-time",
        "30",
        "--proto",
        "=https",
        "--silent",
        "--show-error",
        "--url",
        url,
        "",
      ].join("\n"),
    );
  });

  it.each([
    "http://pr-123.example.pages.dev/projects.md",
    "https://pr-0.example.pages.dev/projects.md",
    "https://pr-123.example.pages.dev.evil.test/projects.md",
    "https://pr-123.example.pages.dev:443/projects.md",
    "https://pr-123.example.pages.dev@evil.test/projects.md",
  ])("rejects a non-canonical target before sending credentials: %s", async (url) => {
    const result = run(url);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Refusing to send Access credentials/);
    await expect(readFile(curlArguments, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(curlInput, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    "example.pages.dev@evil.test",
    "example..pages.dev",
    "EXAMPLE.pages.dev",
    "localhost",
  ])("rejects a malformed configured Pages host: %s", async (pagesHost) => {
    const result = run(`https://pr-123.${pagesHost}/projects.md`, {
      CLOUDFLARE_PAGES_HOST: pagesHost,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "CLOUDFLARE_PAGES_HOST must be a lowercase hostname",
    );
    await expect(readFile(curlArguments, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(curlInput, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails before invoking curl when a credential is absent", async () => {
    const result = run("https://pr-123.example.pages.dev/projects.md", {
      CF_ACCESS_CLIENT_SECRET: "",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CF_ACCESS_CLIENT_SECRET is required");
    await expect(readFile(curlArguments, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
