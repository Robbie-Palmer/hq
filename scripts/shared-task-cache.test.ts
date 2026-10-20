import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
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
      npm_config_user_agent: "pnpm/12.8.1 node/v24.0.0",
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
    timeout: 10_000,
  });
}

function cli(...args: string[]): string[] {
  return [process.execPath, script, ...args];
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
    successful(run(fixture));
    writeFileSync(join(fixture.root, "untracked.txt"), "untracked\n");
    successful(run(fixture));
    spawnSync("git", ["add", "input.txt"], { cwd: fixture.root });
    spawnSync("git", ["commit", "--quiet", "-m", "change revision"], {
      cwd: fixture.root,
    });
    successful(run(fixture));
    fixture.environment.CACHE_TEST_ENV = "two";
    successful(run(fixture));
    fixture.environment.npm_config_user_agent = "pnpm/12.8.2 node/v24.0.0";
    successful(run(fixture));

    expect(readFileSync(fixture.counter, "utf8")).toBe("6");
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

  it("recovers a fresh lock as soon as its local owner is gone", () => {
    const fixture = createFixture();
    successful(run(fixture));
    const taskDirectory = join(fixture.cache, "entries", "fixture");
    const [key] = readdirSync(taskDirectory);
    assert.ok(key);
    rmSync(join(taskDirectory, key), { recursive: true });
    const lockPath = join(fixture.cache, "locks", "fixture", key);
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      join(lockPath, "owner.json"),
      `${JSON.stringify({ host: hostname(), pid: 2_147_483_647 })}\n`,
    );

    successful(run(fixture));
    expect(readFileSync(fixture.counter, "utf8")).toBe("2");
  });

  it("runs directly when cache setup fails", () => {
    const fixture = createFixture();
    writeFileSync(fixture.cache, "not a directory\n");

    const result = run(fixture);

    successful(result);
    expect(result.stderr).toContain("cache unavailable, running task directly");
    expect(readFileSync(fixture.counter, "utf8")).toBe("1");
  });

  it("preserves a successful task result when publishing and pruning fail", () => {
    const fixture = createFixture();
    fixture.environment.SHARED_TASK_CACHE_MAX_BYTES = "invalid";
    const program = `
      const fs = require("node:fs");
      const path = require("node:path");
      fs.mkdirSync("output", { recursive: true });
      fs.writeFileSync("output/result.txt", "complete\\n");
      fs.writeFileSync(path.join(process.env.SHARED_TASK_CACHE_DIR, "tmp"), "blocked\\n");
    `;

    const result = run(
      fixture,
      cli("run", "--task", "publish-failure", "--output", "output", "--", process.execPath, "-e", program),
    );

    successful(result);
    expect(result.stderr).toContain("publish failed");
    expect(result.stderr).toContain("prune failed");
    expect(readFileSync(join(fixture.root, "output/result.txt"), "utf8")).toBe("complete\n");
  });

  it("rejects invalid commands, paths, environment names, and limits", () => {
    const fixture = createFixture();
    const invalidCommands: Array<{ args: string[]; message: string }> = [
      { args: cli(), message: "Usage:" },
      { args: cli("unknown"), message: "Unknown subcommand" },
      { args: cli("run", "--task"), message: "--task requires a value" },
      {
        args: cli("run", "--unknown", "value", "--", process.execPath, "-e", ""),
        message: "Unknown option",
      },
      {
        args: cli("run", "--task", "UPPER", "--", process.execPath, "-e", ""),
        message: "--task must use lowercase",
      },
      { args: cli("run", "--task", "fixture", "--"), message: "A command is required" },
      {
        args: cli(
          "run",
          "--task",
          "fixture",
          "--env",
          "lowercase",
          "--",
          process.execPath,
          "-e",
          "",
        ),
        message: "Invalid environment variable name",
      },
      {
        args: cli(
          "run",
          "--task",
          "fixture",
          "--cwd",
          fixture.root,
          "--",
          process.execPath,
          "-e",
          "",
        ),
        message: "--cwd must be relative",
      },
      {
        args: cli(
          "run",
          "--task",
          "fixture",
          "--output",
          "../outside",
          "--",
          process.execPath,
          "-e",
          "",
        ),
        message: "--output must stay inside",
      },
    ];

    for (const invalid of invalidCommands) {
      const result = run(fixture, invalid.args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(invalid.message);
    }

    for (const value of ["0", "not-a-number"]) {
      fixture.environment.SHARED_TASK_CACHE_MAX_BYTES = value;
      const result = run(fixture, cli("status"));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("SHARED_TASK_CACHE_MAX_BYTES must be a positive integer");
    }

    delete fixture.environment.SHARED_TASK_CACHE_DIR;
    const missingCache = run(fixture, cli("status"));
    expect(missingCache.status).not.toBe(0);
    expect(missingCache.stderr).toContain("SHARED_TASK_CACHE_DIR is required");
  });

  it("runs without a configured cache and never publishes failed work", () => {
    const fixture = createFixture();
    delete fixture.environment.SHARED_TASK_CACHE_DIR;
    const uncached = run(fixture);
    successful(uncached);
    expect(uncached.stdout).not.toContain("shared-task-cache:");
    expect(readFileSync(fixture.counter, "utf8")).toBe("1");

    fixture.environment.SHARED_TASK_CACHE_DIR = fixture.cache;
    const failure = run(
      fixture,
      cli("run", "--task", "failure", "--", process.execPath, "-e", "process.exit(23)"),
    );
    expect(failure.status).toBe(23);
    const metrics = JSON.parse(readFileSync(join(fixture.cache, "metrics.json"), "utf8")) as {
      failures: number;
    };
    expect(metrics.failures).toBe(1);
  });

  it("preserves symlink outputs and reports corrupt metrics", () => {
    const fixture = createFixture();
    const program = `
      const fs = require("node:fs");
      fs.mkdirSync("links", { recursive: true });
      fs.symlinkSync("../input.txt", "links/input-link");
    `;
    const args = cli(
      "run",
      "--task",
      "symlink",
      "--output",
      "links",
      "--",
      process.execPath,
      "-e",
      program,
    );
    successful(run(fixture, args));
    rmSync(join(fixture.root, "links"), { recursive: true });
    successful(run(fixture, args));
    expect(readlinkSync(join(fixture.root, "links", "input-link"))).toBe("../input.txt");

    writeFileSync(join(fixture.cache, "metrics.json"), "{not-json}\n");
    const status = run(fixture, cli("status"));
    successful(status);
    expect((JSON.parse(status.stdout.toString()) as { corruptions: number }).corruptions).toBe(1);
  });

  it("prunes stale temporary work and ignores non-entry files", () => {
    const fixture = createFixture();
    const temporary = join(fixture.cache, "tmp", "abandoned");
    mkdirSync(temporary, { recursive: true });
    writeFileSync(join(temporary, "partial"), "unfinished");
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(temporary, stale, stale);
    const entries = join(fixture.cache, "entries");
    mkdirSync(join(entries, "task"), { recursive: true });
    writeFileSync(join(entries, "README"), "not a task directory");
    writeFileSync(join(entries, "task", "README"), "not an entry directory");

    const result = run(fixture, cli("prune"));
    successful(result);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({ entriesRemoved: 0 });
    expect(() => readFileSync(join(temporary, "partial"))).toThrow();
  });

  it("prunes entries above the configured allocation", () => {
    const fixture = createFixture();
    successful(run(fixture));
    const taskDirectory = join(fixture.cache, "entries", "fixture");
    const [key] = readdirSync(taskDirectory);
    assert.ok(key);
    const entryPath = join(taskDirectory, key);
    const entryLockPath = join(fixture.cache, "locks", "fixture", key);
    mkdirSync(entryLockPath, { recursive: true });
    writeFileSync(
      join(entryLockPath, "owner.json"),
      `${JSON.stringify({ host: hostname(), pid: process.pid })}\n`,
    );
    fixture.environment.SHARED_TASK_CACHE_MAX_BYTES = "1";

    const lockedPrune = run(fixture, cli("prune"));
    successful(lockedPrune);
    expect(JSON.parse(lockedPrune.stdout.toString())).toMatchObject({ entriesRemoved: 0 });
    expect(existsSync(entryPath)).toBe(true);

    rmSync(entryLockPath, { recursive: true });
    const unlockedPrune = run(fixture, cli("prune"));
    successful(unlockedPrune);
    expect(JSON.parse(unlockedPrune.stdout.toString())).toMatchObject({ entriesRemoved: 1 });
    const status = run(fixture, cli("status"));
    successful(status);
    expect((JSON.parse(status.stdout.toString()) as { bytesStored: number }).bytesStored).toBe(0);
  });
});
