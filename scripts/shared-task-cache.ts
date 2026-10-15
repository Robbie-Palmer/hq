#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, platform, arch } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024 * 1024;
const DEFAULT_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
const LOCK_STALE_MILLISECONDS = 2 * 60 * 60 * 1000;
const LOCK_WAIT_MILLISECONDS = 30 * 60 * 1000;
const LOCK_POLL_MILLISECONDS = 250;

interface RunOptions {
  task: string;
  cwd: string;
  outputs: string[];
  environmentNames: string[];
  command: string[];
}

interface ArtifactRecord {
  path: string;
  digest: string;
  bytes: number;
}

interface CacheManifest {
  schemaVersion: number;
  key: string;
  task: string;
  revision: string;
  dirtyDigest: string;
  command: string[];
  cwd: string;
  environment: Record<string, string>;
  outputs: string[];
  artifacts: ArtifactRecord[];
  createdAt: string;
}

interface CacheMetrics {
  schemaVersion: number;
  updatedAt: string;
  hits: number;
  misses: number;
  runs: number;
  failures: number;
  corruptions: number;
  waits: number;
  bytesRestored: number;
  bytesPublished: number;
  bytesReclaimed: number;
}

interface MetricDelta {
  hits?: number;
  misses?: number;
  runs?: number;
  failures?: number;
  corruptions?: number;
  waits?: number;
  bytesRestored?: number;
  bytesPublished?: number;
  bytesReclaimed?: number;
}

interface CacheIdentity {
  key: string;
  revision: string;
  dirtyDigest: string;
  environment: Record<string, string>;
}

interface CacheEntry {
  path: string;
  lockPath: string;
  bytes: number;
  modifiedAt: number;
}

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(`Usage:
  shared-task-cache run --task <id> [--cwd <path>] [--output <path>] [--env <name>] -- <command> [args...]
  shared-task-cache prune
  shared-task-cache status`);
  process.exit(2);
}

function runGit(root: string, args: string[], encoding: BufferEncoding | "buffer" = "utf8"): string | Buffer {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: encoding === "buffer" ? undefined : encoding,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr).trim()}`);
  }
  return result.stdout;
}

function repositoryRoot(): string {
  return String(runGit(process.cwd(), ["rev-parse", "--show-toplevel"])).trim();
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function cacheRoot(required: boolean): string | undefined {
  const configured = process.env.SHARED_TASK_CACHE_DIR;
  if (!configured && required) throw new Error("SHARED_TASK_CACHE_DIR is required");
  return configured ? resolve(configured) : undefined;
}

function normalizeRelativePath(value: string, root: string, label: string): string {
  if (isAbsolute(value)) throw new Error(`${label} must be relative to the repository root`);
  const normalized = normalize(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === ".") return normalized;
  if (normalized === "" || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  const resolved = resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  return normalized;
}

function assignRunOption(
  argument: string,
  value: string,
  parsed: { task: string; cwd: string; outputs: string[]; environmentNames: string[] },
): void {
  if (argument === "--task") parsed.task = value;
  else if (argument === "--cwd") parsed.cwd = value;
  else if (argument === "--output") parsed.outputs.push(value);
  else if (argument === "--env") parsed.environmentNames.push(value);
  else usage(`Unknown option: ${argument}`);
}

function parseRunOptions(args: string[], root: string): RunOptions {
  const parsed = { task: "", cwd: ".", outputs: [] as string[], environmentNames: [] as string[] };
  let index = 0;
  for (; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      index += 1;
      break;
    }
    const value = args[index + 1];
    if (!value) usage(`${argument} requires a value`);
    assignRunOption(argument, value, parsed);
    index += 1;
  }
  const command = args.slice(index);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(parsed.task)) {
    usage("--task must use lowercase letters, digits, dashes, or underscores");
  }
  if (command.length === 0) usage("A command is required after --");
  for (const name of parsed.environmentNames) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) usage(`Invalid environment variable name: ${name}`);
  }
  return {
    task: parsed.task,
    cwd: normalizeRelativePath(parsed.cwd, root, "--cwd"),
    outputs: [
      ...new Set(parsed.outputs.map((output) => normalizeRelativePath(output, root, "--output"))),
    ].sort(),
    environmentNames: [...new Set(parsed.environmentNames)].sort(),
    command,
  };
}

function hashFile(path: string): { digest: string; bytes: number } {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(path, "r");
  let bytes = 0;
  try {
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      bytes += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return { digest: hash.digest("hex"), bytes };
}

function hashPath(path: string): { digest: string; bytes: number } {
  const metadata = lstatSync(path);
  const hash = createHash("sha256");
  hash.update(`${metadata.mode & 0o7777}\0`);
  if (metadata.isSymbolicLink()) {
    hash.update("symlink\0");
    hash.update(readlinkSync(path));
    return { digest: hash.digest("hex"), bytes: 0 };
  }
  if (metadata.isFile()) {
    const file = hashFile(path);
    hash.update("file\0");
    hash.update(file.digest);
    return { digest: hash.digest("hex"), bytes: file.bytes };
  }
  if (!metadata.isDirectory()) throw new Error(`Unsupported artifact type: ${path}`);
  hash.update("directory\0");
  let bytes = 0;
  for (const name of readdirSync(path).sort()) {
    const child = hashPath(join(path, name));
    hash.update(name);
    hash.update("\0");
    hash.update(child.digest);
    bytes += child.bytes;
  }
  return { digest: hash.digest("hex"), bytes };
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dirtyDigest(root: string): string {
  const hash = createHash("sha256");
  hash.update(runGit(root, ["diff", "--binary", "HEAD", "--"], "buffer"));
  const untrackedOutput = runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"], "buffer") as Buffer;
  const untracked = untrackedOutput.toString().split("\0").filter(Boolean).sort();
  for (const path of untracked) {
    const record = hashPath(join(root, path));
    hash.update(path);
    hash.update("\0");
    hash.update(record.digest);
  }
  return hash.digest("hex");
}

function commandVersion(command: string): string {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unavailable";
}

function cacheIdentity(root: string, options: RunOptions): CacheIdentity {
  const revision = String(runGit(root, ["rev-parse", "HEAD"])).trim();
  const dirty = dirtyDigest(root);
  const environment = Object.fromEntries(
    options.environmentNames.map((name) => [name, hashValue(process.env[name] ?? "<unset>")]),
  );
  const lockfile = hashFile(join(root, "pnpm-lock.yaml")).digest;
  const identity = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    task: options.task,
    revision,
    dirtyDigest: dirty,
    command: options.command,
    cwd: options.cwd,
    outputs: options.outputs,
    environment,
    platform: platform(),
    architecture: arch(),
    node: process.version,
    pnpm: commandVersion("pnpm"),
    lockfile,
  };
  return {
    key: hashValue(JSON.stringify(identity)),
    revision,
    dirtyDigest: dirty,
    environment,
  };
}

function defaultMetrics(): CacheMetrics {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    hits: 0,
    misses: 0,
    runs: 0,
    failures: 0,
    corruptions: 0,
    waits: 0,
    bytesRestored: 0,
    bytesPublished: 0,
    bytesReclaimed: 0,
  };
}

function readMetrics(path: string): CacheMetrics {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheMetrics;
  const counters = [
    parsed.hits,
    parsed.misses,
    parsed.runs,
    parsed.failures,
    parsed.corruptions,
    parsed.waits,
    parsed.bytesRestored,
    parsed.bytesPublished,
    parsed.bytesReclaimed,
  ];
  if (
    parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
    typeof parsed.updatedAt !== "string" ||
    counters.some((counter) => !Number.isSafeInteger(counter) || counter < 0)
  ) {
    throw new Error("Invalid cache metrics");
  }
  return parsed;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function lockIsStale(path: string): boolean {
  try {
    const age = Date.now() - statSync(path).mtimeMs;
    if (age <= LOCK_STALE_MILLISECONDS) return false;
    const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as {
      host?: string;
      pid?: number;
    };
    if (owner.host === hostname() && typeof owner.pid === "number") {
      try {
        process.kill(owner.pid, 0);
        return false;
      } catch {
        return true;
      }
    }
    return true;
  } catch {
    return true;
  }
}

async function acquireLock(path: string): Promise<{ release: () => void; waited: boolean }> {
  const startedAt = Date.now();
  let waited = false;
  while (true) {
    try {
      mkdirSync(path, { recursive: false, mode: 0o750 });
      writeFileSync(
        join(path, "owner.json"),
        `${JSON.stringify({ host: hostname(), pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        { mode: 0o640 },
      );
      return {
        waited,
        release: () => rmSync(path, { recursive: true, force: true }),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      waited = true;
      if (lockIsStale(path)) {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - startedAt > LOCK_WAIT_MILLISECONDS) {
        throw new Error(`Timed out waiting for cache lock ${path}`);
      }
      await delay(LOCK_POLL_MILLISECONDS);
    }
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${hostname()}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
  renameSync(temporary, path);
}

async function recordMetrics(root: string, delta: MetricDelta): Promise<void> {
  const lockPath = join(root, "locks", "metrics");
  mkdirSync(dirname(lockPath), { recursive: true });
  const lock = await acquireLock(lockPath);
  try {
    const path = join(root, "metrics.json");
    let metrics = defaultMetrics();
    if (existsSync(path)) {
      try {
        metrics = readMetrics(path);
      } catch {
        metrics.corruptions += 1;
      }
    }
    for (const [name, amount] of Object.entries(delta)) {
      metrics[name as keyof MetricDelta] += amount ?? 0;
    }
    metrics.schemaVersion = CACHE_SCHEMA_VERSION;
    metrics.updatedAt = new Date().toISOString();
    writeJsonAtomic(path, metrics);
  } finally {
    lock.release();
  }
}

function readManifest(entryPath: string): CacheManifest | undefined {
  try {
    return JSON.parse(readFileSync(join(entryPath, "manifest.json"), "utf8")) as CacheManifest;
  } catch {
    return undefined;
  }
}

function validateEntry(entryPath: string, identity: CacheIdentity, options: RunOptions): CacheManifest | undefined {
  try {
    const manifest = readManifest(entryPath);
    if (
      !manifest ||
      manifest.schemaVersion !== CACHE_SCHEMA_VERSION ||
      manifest.key !== identity.key ||
      manifest.revision !== identity.revision ||
      manifest.dirtyDigest !== identity.dirtyDigest ||
      manifest.task !== options.task ||
      JSON.stringify(manifest.environment) !== JSON.stringify(identity.environment) ||
      JSON.stringify(manifest.outputs) !== JSON.stringify(options.outputs) ||
      !Array.isArray(manifest.artifacts) ||
      manifest.artifacts.length !== options.outputs.length
    ) {
      return undefined;
    }
    for (const artifact of manifest.artifacts) {
      if (!options.outputs.includes(artifact.path)) return undefined;
      const artifactPath = join(entryPath, "artifacts", artifact.path);
      if (!existsSync(artifactPath)) return undefined;
      const actual = hashPath(artifactPath);
      if (actual.digest !== artifact.digest || actual.bytes !== artifact.bytes) return undefined;
    }
    return manifest;
  } catch {
    return undefined;
  }
}

function copyPath(source: string, destination: string): void {
  const metadata = lstatSync(source);
  mkdirSync(dirname(destination), { recursive: true });
  if (metadata.isSymbolicLink()) {
    symlinkSync(readlinkSync(source), destination);
    return;
  }
  cpSync(source, destination, {
    recursive: metadata.isDirectory(),
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

function restoreArtifacts(root: string, entryPath: string, manifest: CacheManifest): number {
  if (manifest.outputs.length === 0) return 0;
  const staging = join(root, `.shared-task-cache-restore-${process.pid}-${Date.now()}`);
  let bytes = 0;
  try {
    mkdirSync(staging, { recursive: false, mode: 0o750 });
    for (const artifact of manifest.artifacts) {
      const source = join(entryPath, "artifacts", artifact.path);
      const destination = join(staging, artifact.path);
      copyPath(source, destination);
      const restored = hashPath(destination);
      if (restored.digest !== artifact.digest || restored.bytes !== artifact.bytes) {
        throw new Error(`Restored artifact failed verification: ${artifact.path}`);
      }
      bytes += restored.bytes;
    }
    for (const output of manifest.outputs) {
      const destination = join(root, output);
      rmSync(destination, { recursive: true, force: true });
      mkdirSync(dirname(destination), { recursive: true });
      renameSync(join(staging, output), destination);
    }
    return bytes;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function publishEntry(
  root: string,
  cachePath: string,
  entryPath: string,
  identity: CacheIdentity,
  options: RunOptions,
): CacheManifest {
  const temporaryRoot = join(cachePath, "tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const temporary = join(temporaryRoot, `${options.task}-${identity.key}-${hostname()}-${process.pid}`);
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(join(temporary, "artifacts"), { recursive: true, mode: 0o750 });
  try {
    const artifacts = options.outputs.map((output) => {
      const source = join(root, output);
      if (!existsSync(source)) throw new Error(`Declared cache output does not exist: ${output}`);
      const destination = join(temporary, "artifacts", output);
      copyPath(source, destination);
      const original = hashPath(source);
      const copied = hashPath(destination);
      if (original.digest !== copied.digest || original.bytes !== copied.bytes) {
        throw new Error(`Cached artifact failed verification: ${output}`);
      }
      return { path: output, digest: copied.digest, bytes: copied.bytes };
    });
    const manifest: CacheManifest = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      key: identity.key,
      task: options.task,
      revision: identity.revision,
      dirtyDigest: identity.dirtyDigest,
      command: options.command,
      cwd: options.cwd,
      environment: identity.environment,
      outputs: options.outputs,
      artifacts,
      createdAt: new Date().toISOString(),
    };
    writeJsonAtomic(join(temporary, "manifest.json"), manifest);
    mkdirSync(dirname(entryPath), { recursive: true });
    renameSync(temporary, entryPath);
    return manifest;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function runCommand(root: string, options: RunOptions): number {
  const [command, ...args] = options.command;
  const result = spawnSync(command, args, {
    cwd: join(root, options.cwd),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function directoryBytes(path: string): number {
  if (!existsSync(path)) return 0;
  const metadata = lstatSync(path);
  if (metadata.isFile()) return metadata.size;
  if (!metadata.isDirectory()) return 0;
  return readdirSync(path).reduce((sum, name) => sum + directoryBytes(join(path, name)), 0);
}

function listEntries(root: string): CacheEntry[] {
  const entriesRoot = join(root, "entries");
  if (!existsSync(entriesRoot)) return [];
  const entries: CacheEntry[] = [];
  for (const task of readdirSync(entriesRoot)) {
    const taskPath = join(entriesRoot, task);
    if (!lstatSync(taskPath).isDirectory()) continue;
    for (const key of readdirSync(taskPath)) {
      const path = join(taskPath, key);
      if (!lstatSync(path).isDirectory()) continue;
      entries.push({
        path,
        lockPath: join(root, "locks", task, key),
        bytes: directoryBytes(path),
        modifiedAt: statSync(path).mtimeMs,
      });
    }
  }
  return entries;
}

async function pruneCache(root: string): Promise<{ bytesReclaimed: number; entriesRemoved: number }> {
  const lockPath = join(root, "locks", "prune");
  mkdirSync(dirname(lockPath), { recursive: true });
  const lock = await acquireLock(lockPath);
  let bytesReclaimed = 0;
  let entriesRemoved = 0;
  try {
    const maxBytes = parsePositiveInteger(
      process.env.SHARED_TASK_CACHE_MAX_BYTES,
      DEFAULT_MAX_BYTES,
      "SHARED_TASK_CACHE_MAX_BYTES",
    );
    const maxAgeSeconds = parsePositiveInteger(
      process.env.SHARED_TASK_CACHE_MAX_AGE_SECONDS,
      DEFAULT_MAX_AGE_SECONDS,
      "SHARED_TASK_CACHE_MAX_AGE_SECONDS",
    );
    const now = Date.now();
    const entries = listEntries(root).sort((left, right) => left.modifiedAt - right.modifiedAt);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of entries) {
      const expired = now - entry.modifiedAt > maxAgeSeconds * 1000;
      if (!expired && totalBytes <= maxBytes) continue;
      if (existsSync(entry.lockPath)) continue;
      rmSync(entry.path, { recursive: true, force: true });
      totalBytes -= entry.bytes;
      bytesReclaimed += entry.bytes;
      entriesRemoved += 1;
    }
    const temporaryRoot = join(root, "tmp");
    if (existsSync(temporaryRoot)) {
      for (const name of readdirSync(temporaryRoot)) {
        const path = join(temporaryRoot, name);
        if (now - statSync(path).mtimeMs > LOCK_STALE_MILLISECONDS) {
          bytesReclaimed += directoryBytes(path);
          rmSync(path, { recursive: true, force: true });
        }
      }
    }
  } finally {
    lock.release();
  }
  if (bytesReclaimed > 0) await recordMetrics(root, { bytesReclaimed });
  return { bytesReclaimed, entriesRemoved };
}

async function cachedRun(root: string, cachePath: string, options: RunOptions): Promise<number> {
  mkdirSync(cachePath, { recursive: true, mode: 0o750 });
  const identity = cacheIdentity(root, options);
  const entryPath = join(cachePath, "entries", options.task, identity.key);
  const lockPath = join(cachePath, "locks", options.task, identity.key);
  mkdirSync(dirname(lockPath), { recursive: true });
  const lock = await acquireLock(lockPath);
  if (lock.waited) await recordMetrics(cachePath, { waits: 1 });
  try {
    if (existsSync(entryPath)) {
      const manifest = validateEntry(entryPath, identity, options);
      if (manifest) {
        const restoredBytes = restoreArtifacts(root, entryPath, manifest);
        const now = new Date();
        utimesSync(entryPath, now, now);
        await recordMetrics(cachePath, { hits: 1, bytesRestored: restoredBytes });
        console.log(`shared-task-cache: hit ${options.task} ${identity.key.slice(0, 12)}`);
        return 0;
      }
      rmSync(entryPath, { recursive: true, force: true });
      await recordMetrics(cachePath, { corruptions: 1 });
      console.warn(`shared-task-cache: rejected corrupt entry ${options.task} ${identity.key.slice(0, 12)}`);
    }

    await recordMetrics(cachePath, { misses: 1, runs: 1 });
    console.log(`shared-task-cache: miss ${options.task} ${identity.key.slice(0, 12)}`);
    const status = runCommand(root, options);
    if (status !== 0) {
      await recordMetrics(cachePath, { failures: 1 });
      return status;
    }
    const manifest = publishEntry(root, cachePath, entryPath, identity, options);
    const publishedBytes = manifest.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
    await recordMetrics(cachePath, { bytesPublished: publishedBytes });
    return 0;
  } finally {
    lock.release();
    await pruneCache(cachePath);
  }
}

function statusReport(root: string): Record<string, unknown> {
  let metrics = defaultMetrics();
  const metricsPath = join(root, "metrics.json");
  if (existsSync(metricsPath)) {
    try {
      metrics = readMetrics(metricsPath);
    } catch {
      metrics.corruptions += 1;
    }
  }
  const entries = listEntries(root);
  return {
    ...metrics,
    cacheDirectory: root,
    entries: entries.length,
    bytesStored: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    maxBytes: parsePositiveInteger(
      process.env.SHARED_TASK_CACHE_MAX_BYTES,
      DEFAULT_MAX_BYTES,
      "SHARED_TASK_CACHE_MAX_BYTES",
    ),
    maxAgeSeconds: parsePositiveInteger(
      process.env.SHARED_TASK_CACHE_MAX_AGE_SECONDS,
      DEFAULT_MAX_AGE_SECONDS,
      "SHARED_TASK_CACHE_MAX_AGE_SECONDS",
    ),
  };
}

async function main(): Promise<void> {
  const [subcommand, ...args] = process.argv.slice(2);
  if (subcommand === "run") {
    const root = repositoryRoot();
    const options = parseRunOptions(args, root);
    const configuredCache = cacheRoot(false);
    const status = configuredCache
      ? await cachedRun(root, configuredCache, options)
      : runCommand(root, options);
    process.exitCode = status;
    return;
  }
  if (subcommand === "prune") {
    const configuredCache = cacheRoot(true);
    const result = await pruneCache(configuredCache);
    console.log(JSON.stringify(result));
    return;
  }
  if (subcommand === "status") {
    console.log(JSON.stringify(statusReport(cacheRoot(true)), null, 2));
    return;
  }
  usage(subcommand ? `Unknown subcommand: ${subcommand}` : undefined);
}

main().catch((error: unknown) => {
  appendFileSync(2, `shared-task-cache: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
