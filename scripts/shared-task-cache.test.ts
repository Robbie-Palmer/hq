import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = new URL("./shared-task-cache.ts", import.meta.url).pathname;
const temporaryDirectories: string[] = [];

interface Fixture {
  root: string;
  cache: string;
  counter: string;
  environment: NodeJS.ProcessEnv;
}

function command(delayMilliseconds = 0): string[] {
  const program = `
    const fs = require("node:fs");
    const delay = ${delayMilliseconds};
    const countPath = process.env.CACHE_TEST_COUNTER;
    const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, "utf8")) : 0;
    fs.writeFileSync(countPath, String(count + 1));
    setTimeout(() => {
      fs.mkdirSync("output", { recursive: true });
      fs.writeFileSync("output/result.txt", fs.readFileSync("input.txt", "utf8"));
    }, delay);
  `;
  return [
    process.execPath,
    script,
    "run",
    "--task",
    "fixture",
    "--output",
    "output",
    "--env",
    "CACHE_TEST_ENV",
    "--",
    process.execPath,
    "-e",
    program,
  ];
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "shared-task-cache-test-"));
  temporaryDirectories.push(base);
  const root = join(base, "repository");
  const cache = join(base, "cache");
  const counter = join(base, "runs.txt");
  mkdirSync(root);
  spawnSync("git", ["init", "--quiet"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Cache Test"], { cwd: root });
  spawnSync("git", ["config", "user.email", "cache@example.invalid"], { cwd: root });
  writeFileSync(join(root, "input.txt"), "revision-one\n");
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(root, ".gitignore"), "output/\n");
  spawnSync("git", ["add", "."], { cwd: root });
  spawnSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  return {
    root,
    cache,
    counter,
    environment: {
      ...process.env,
      CACHE_TEST_ENV: "one",
      CACHE_TEST_COUNTER: counter,
      SHARED_TASK_CACHE_DIR: cache,
      SHARED_TASK_CACHE_MAX_BYTES: "1048576",
      SHARED_TASK_CACHE_MAX_AGE_SECONDS: "3600",
    },
  };
}

function run(fixture: Fixture, args = command()): ReturnType<typeof spawnSync> {
  return spawnSync(args[0] ?? "", args.slice(1), {
    cwd: fixture.root,
    encoding: "utf8",
    env: fixture.environment,
  });
}

function successful(result: ReturnType<typeof spawnSync>): void {
  assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("shared task cache", () => {
  it("restores verified outputs without rerunning the command", () => {
    const fixture = createFixture();
    successful(run(fixture));
    expect(readFileSync(fixture.counter, "utf8")).toBe("1");
    rmSync(join(fixture.root, "output"), { recursive: true });

    const hit = run(fixture);
    successful(hit);
    expect(hit.stdout).toContain("shared-task-cache: hit");
    expect(readFileSync(fixture.counter, "utf8")).toBe("1");
    expect(readFileSync(join(fixture.root, "output/result.txt"), "utf8")).toBe("revision-one\n");
  });

  it("uses separate entries for changed source and environment", () => {
    const fixture = createFixture();
    successful(run(fixture));
    writeFileSync(join(fixture.root, "input.txt"), "dirty-revision\n");
    spawnSync("git", ["add", "input.txt"], { cwd: fixture.root });
    spawnSync("git", ["commit", "--quiet", "-m", "change revision"], {
      cwd: fixture.root,
    });
    successful(run(fixture));
    fixture.environment.CACHE_TEST_ENV = "two";
    successful(run(fixture));

    expect(readFileSync(fixture.counter, "utf8")).toBe("3");
    expect(readFileSync(join(fixture.root, "output/result.txt"), "utf8")).toBe("dirty-revision\n");
  });

  it("coalesces concurrent writers for one key", async () => {
    const fixture = createFixture();
    const args = command(500);
    const launch = () =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveProcess) => {
        const child = spawn(args[0] ?? "", args.slice(1), {
          cwd: fixture.root,
          env: fixture.environment,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("close", (status) => resolveProcess({ status, stdout, stderr }));
      });

    const results = await Promise.all([launch(), launch()]);
    expect(results, results.map((result) => result.stderr).join("\n")).toSatisfy((values) =>
      values.every((value) => value.status === 0),
    );
    expect(results.filter((result) => result.stdout.includes("shared-task-cache: miss"))).toHaveLength(1);
    expect(results.filter((result) => result.stdout.includes("shared-task-cache: hit"))).toHaveLength(1);
    expect(readFileSync(fixture.counter, "utf8")).toBe("1");
    const metrics = JSON.parse(
      readFileSync(join(fixture.cache, "metrics.json"), "utf8"),
    ) as { hits: number; misses: number; runs: number; waits: number };
    expect(metrics).toMatchObject({ hits: 1, misses: 1, runs: 1, waits: 1 });
  });

  it("rejects a modified cache artifact and rebuilds it", () => {
    const fixture = createFixture();
    successful(run(fixture));
    const taskDirectory = join(fixture.cache, "entries", "fixture");
    const [key] = spawnSync("ls", [taskDirectory], { encoding: "utf8" }).stdout.trim().split("\n");
    assert.ok(key);
    writeFileSync(join(taskDirectory, key, "artifacts", "output", "result.txt"), "corrupt\n");

    const recovery = run(fixture);
    successful(recovery);
    expect(recovery.stderr).toContain("rejected corrupt entry");
    expect(readFileSync(fixture.counter, "utf8")).toBe("2");
    expect(readFileSync(join(fixture.root, "output/result.txt"), "utf8")).toBe("revision-one\n");
  });

  it("prunes entries above the configured allocation", () => {
    const fixture = createFixture();
    fixture.environment.SHARED_TASK_CACHE_MAX_BYTES = "1";
    successful(run(fixture));
    mkdirSync(fixture.cache, { recursive: true });
    const result = run(fixture, [process.execPath, script, "prune"]);
    successful(result);
    const report = JSON.parse(result.stdout.toString()) as { entriesRemoved: number };
    expect(report.entriesRemoved).toBeGreaterThanOrEqual(0);
    const status = run(fixture, [process.execPath, script, "status"]);
    successful(status);
    expect((JSON.parse(status.stdout.toString()) as { bytesStored: number }).bytesStored).toBe(0);
  });
});
