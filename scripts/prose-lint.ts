/**
 * prose-lint.ts — deterministic prose linter wrapper around Vale.
 *
 * Reads Vale JSON output and filters to only the lines changed in the
 * working tree (or, with --staged, the index). This lets us add
 * high-confidence rules incrementally without flooding the developer with
 * pre-existing issues.
 *
 * Usage:
 *   mise run //:lint:prose -- [files...]
 *   mise run //:lint:prose:staged           # staged changes only
 *   mise run //:lint:prose:check            # full repo, enforce active errors
 *   mise run //:lint:prose:audit            # full repo, audit broad styles
 *
 * Exit codes:
 *   0 — no blocking issues on changed lines
 *   1 — blocking issues found (or vale itself failed)
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * Intentional prose-lint exemptions live in ./prose-exemptions.json (next to
 * this script).  Each entry suppresses a specific rule alert on a specific
 * line of a specific file — e.g. a published post's wording that we want to
 * keep as-is.  An entry matches only when the file, line number, and check
 * name all agree, so it never blanket-suppresses a whole line or file.
 */
interface ProseExemption {
  file: string;
  line: number;
  checks: string[];
}

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

function resolveBinary(name: string): string {
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

const GIT_BIN = resolveBinary("git");
const VALE_BIN = process.env.VALE_BIN || resolveBinary("vale");
const VALE_CONFIG = resolve(
  process.env.VALE_CONFIG || join(import.meta.dirname, "..", ".vale.ini"),
);

/* ------------------------------------------------------------------ */
/*  Help                                                              */
/* ------------------------------------------------------------------ */

function printHelp(): never {
  console.log(`
Usage: prose-lint.ts [options] [files...]

Options:
  --staged       Compare against the git index (cached diff).
                 Implies --base=HEAD --diff=cached.
  --base <ref>   Git base ref to diff against (default: HEAD).
                 Ignored when --staged is set.
  --diff <type>  Diff type: "cached" (staged), "working" (unstaged),
                 or "auto" (default: "auto").  Auto picks working for
                 tracked files, full scan for untracked.
  --all          Treat every line of every file as changed (whole-file
                 scan; used by lint:prose:check).
  --tracked      Load all tracked Markdown and MDX paths from Git.
  --report-only  Print content alerts without returning a failure. Vale and
                 configuration failures still return a failure.
  --             Treat every remaining argument as a file path.
  --help         Print this help and exit.

Exit codes:
  0 — no blocking issues on changed lines
  1 — blocking issues found (or vale itself failed)

When lint-staged triggers this script it passes the staged file paths
without flags.  Run with --staged (via lint:prose:staged) so pre-commit
enforcement inspects the index rather than the working tree.

Environment:
  VALE_BIN     Override the Vale binary path.
  VALE_CONFIG  Override the Vale configuration path.
`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/*  Git helpers                                                        */
/* ------------------------------------------------------------------ */

function changedLines(
  file: string,
  ref: string,
  cached: boolean,
): Set<number> | null {
  const args = cached
    ? ["diff", "--cached", "--unified=0", ref, "--", file]
    : ["diff", "--unified=0", ref, "--", file];

  let stdout: string;
  try {
    stdout = execFileSync(GIT_BIN, args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    if (err.stderr) console.error(err.stderr.trimEnd());
    console.error(`prose-lint: git ${args.join(" ")} failed`);
    process.exit(1);
  }

  if (!stdout) return null;

  const lines = new Set<number>();
  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m: RegExpExecArray | null;
  while ((m = hunkRe.exec(stdout)) !== null) {
    const start = Number(m[1]);
    const count = m[2] ? Number(m[2]) : 1;
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines.size > 0 ? lines : null;
}

function allLines(file: string): Set<number> {
  try {
    const content = readFileSync(file, "utf-8");
    const lineCount = content.split("\n").length;
    return new Set(Array.from({ length: lineCount }, (_, i) => i + 1));
  } catch {
    return new Set();
  }
}

function isTracked(file: string): boolean {
  try {
    execFileSync(GIT_BIN, ["ls-files", "--error-unmatch", "--", file], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch (e: unknown) {
    const err = e as { status?: number; stderr?: string };
    if (err.status === 1) return false;
    if (err.stderr) console.error(err.stderr.trimEnd());
    console.error(`prose-lint: git ls-files failed for ${file}`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/*  Vale runner                                                        */
/* ------------------------------------------------------------------ */

interface ValeAlert {
  Check: string;
  File: string;
  Line: number;
  Message: string;
  Severity: "error" | "warning" | "suggestion";
}

const SEVERITY_LABEL: Record<ValeAlert["Severity"], string> = {
  error: "BLOCK",
  warning: "WARN",
  suggestion: "SUGGEST",
};

interface ValeOutput {
  [file: string]: ValeAlert[];
}

function flattenValeOutput(parsed: ValeOutput): ValeAlert[] {
  return Object.entries(parsed).flatMap(([file, fileAlerts]) =>
    fileAlerts.map((alert) => ({ ...alert, File: file })),
  );
}

function runValeBatch(files: string[]): ValeAlert[] {
  const args = ["--config", VALE_CONFIG, "--output", "JSON", ...files];

  let stdout: string;
  let failed = false;
  let failure = "";
  let failureStatus = 1;
  try {
    stdout = execFileSync(VALE_BIN, args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e: unknown) {
    const err = e as {
      stdout?: string;
      stderr?: string;
      status?: number;
      message?: string;
    };
    failed = true;
    failureStatus = err.status ?? 1;
    stdout = err.stdout || "";
    if (err.stderr) {
      failure = err.stderr.trimEnd();
    } else if (!stdout) {
      failure = `vale failed: ${String(err.message || "unknown error")}`;
    }
  }

  if (failed && !stdout) {
    // Spawn/config failure produces no JSON — surface it clearly.
    console.error(failure || "prose-lint: vale failed to run");
    process.exit(failureStatus);
  }
  if (failure) console.error(failure);

  try {
    const parsed: ValeOutput = JSON.parse(stdout);
    return flattenValeOutput(parsed);
  } catch {
    console.error("prose-lint: failed to parse Vale JSON output");
    console.error(stdout);
    process.exit(1);
  }
}

function valeBatches(files: string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let characters = 0;

  for (const file of files) {
    if (
      batch.length > 0 &&
      (batch.length >= 100 || characters + file.length > 24_000)
    ) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(file);
    characters += file.length + 1;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function runVale(files: string[]): ValeAlert[] {
  return valeBatches(files).flatMap(runValeBatch);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

type DiffMode = "cached" | "working" | "auto";

interface ProseOptions {
  files: string[];
  staged: boolean;
  all: boolean;
  tracked: boolean;
  reportOnly: boolean;
  explicitDiff: DiffMode | null;
  base: string;
}

function requireValue(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`prose-lint: ${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

function parseDiffType(value: string): DiffMode {
  if (value === "cached" || value === "working" || value === "auto") return value;
  console.error(`prose-lint: unknown diff type ${value}`);
  process.exit(1);
}

function applyBooleanFlag(opts: ProseOptions, arg: string): boolean {
  if (arg === "--staged") opts.staged = true;
  else if (arg === "--all") opts.all = true;
  else if (arg === "--tracked") opts.tracked = true;
  else if (arg === "--report-only") opts.reportOnly = true;
  else return false;
  return true;
}

function parseArgs(argv: string[]): ProseOptions {
  const opts: ProseOptions = {
    files: [],
    staged: false,
    all: false,
    tracked: false,
    reportOnly: false,
    explicitDiff: null,
    base: "HEAD",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") {
      opts.base = requireValue(argv, i, "--base");
      i++;
    } else if (arg === "--diff") {
      opts.explicitDiff = parseDiffType(requireValue(argv, i, "--diff"));
      i++;
    } else if (applyBooleanFlag(opts, arg)) continue;
    else if (arg === "--help") printHelp();
    else if (arg === "--") {
      opts.files.push(...argv.slice(i + 1));
      break;
    } else if (arg.startsWith("--")) {
      console.error(`prose-lint: unknown flag ${arg}`);
      process.exit(1);
    } else opts.files.push(arg);
  }
  return opts;
}

function trackedProseFiles(): string[] {
  try {
    return execFileSync(
      GIT_BIN,
      ["ls-files", "-z", "--", "*.md", "*.mdx"],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
      .split("\0")
      .filter(Boolean);
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    if (err.stderr) console.error(err.stderr.trimEnd());
    console.error("prose-lint: git ls-files failed");
    process.exit(1);
  }
}

function stagedProseFiles(): string[] {
  try {
    return execFileSync(
      GIT_BIN,
      ["diff", "--cached", "--name-only", "-z", "--", "*.md", "*.mdx"],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
      .split("\0")
      .filter(Boolean);
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    if (err.stderr) console.error(err.stderr.trimEnd());
    console.error("prose-lint: git diff --cached failed");
    process.exit(1);
  }
}

function isNonContentPath(file: string): boolean {
  const norm = file.replaceAll("\\", "/");
  return (
    norm.startsWith("./.vale/") ||
    norm.startsWith(".vale/") ||
    norm.includes("/.vale/") ||
    norm.startsWith("./.agents/skills/") ||
    norm.startsWith(".agents/skills/") ||
    norm.includes("/.agents/skills/")
  );
}

function contentFilesOnly(files: string[]): string[] {
  return files.filter((f) => !isNonContentPath(f));
}

function changedLinesFor(
  file: string,
  base: string,
  mode: DiffMode,
): Set<number> | null {
  if (mode === "cached") return changedLines(file, base, true);
  if (mode === "working") return changedLines(file, base, false);

  let lines = changedLines(file, base, false);
  lines ??= changedLines(file, base, true);
  // Untracked files have no base content to diff against, so scan the
  // whole file.  Tracked-but-unchanged files yield no set and are
  // skipped entirely, keeping enforcement deterministic to the diff.
  if (lines === null && !isTracked(file)) lines = allLines(file);
  return lines;
}

function buildChangedMap(
  files: string[],
  all: boolean,
  base: string,
  diffMode: DiffMode,
): Map<string, Set<number> | null> {
  const changedMap = new Map<string, Set<number> | null>();
  for (const f of files) {
    const lines = all ? allLines(f) : changedLinesFor(f, base, diffMode);
    changedMap.set(resolve(f), lines);
  }
  return changedMap;
}

const EXEMPTIONS_FILE = resolve(import.meta.dirname, "prose-exemptions.json");
const REPO_ROOT = resolve(".");

function isExemptionEntry(value: unknown): value is ProseExemption {
  const e = value as Partial<ProseExemption>;
  return (
    typeof e.file === "string" &&
    e.file.length > 0 &&
    !isAbsolute(e.file) &&
    typeof e.line === "number" &&
    Number.isInteger(e.line) &&
    Array.isArray(e.checks) &&
    e.checks.every((c) => typeof c === "string" && c.length > 0)
  );
}

function loadExemptions(): ProseExemption[] {
  if (!existsSync(EXEMPTIONS_FILE)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(EXEMPTIONS_FILE, "utf-8"));
    if (!Array.isArray(parsed)) {
      throw new Error(`expected a JSON array, got ${typeof parsed}`);
    }
    for (const entry of parsed) {
      if (!isExemptionEntry(entry)) {
        throw new Error(`malformed entry: ${JSON.stringify(entry)}`);
      }
    }
    // Normalise file paths to absolute so they match resolve() keys, and
    // require each one to stay within the repository root.
    return parsed.map((e) => {
      const file = resolve(e.file);
      const rel = relative(REPO_ROOT, file);
      if (isAbsolute(rel) || rel.startsWith("..")) {
        throw new Error(
          `file outside repository root: ${JSON.stringify(e.file)}`,
        );
      }
      return { file, line: e.line, checks: e.checks };
    });
  } catch (err) {
    console.error(
      `prose-lint: invalid ${EXEMPTIONS_FILE}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(1);
  }
}

function isExempt(
  alert: ValeAlert,
  exemptions: ProseExemption[],
): boolean {
  const file = resolve(alert.File);
  return exemptions.some(
    (e) => e.file === file && e.line === alert.Line &&
      e.checks.includes(alert.Check),
  );
}

function changedAlerts(
  alerts: ValeAlert[],
  changedMap: Map<string, Set<number> | null>,
  exemptions: ProseExemption[],
): ValeAlert[] {
  return alerts.filter((alert) => {
    const changed = changedMap.get(resolve(alert.File));
    if (!changed || !changed.has(alert.Line)) return false;
    return !isExempt(alert, exemptions);
  });
}

function reportAlerts(alerts: ValeAlert[], reportOnly: boolean): void {
  let hasBlockers = false;

  for (const alert of alerts) {
    console.log(
      `${SEVERITY_LABEL[alert.Severity]}  ${alert.File}:${alert.Line}  ${alert.Message}  [${alert.Check}]`,
    );
    if (alert.Severity === "error") hasBlockers = true;
  }

  if (reportOnly) process.exit(0);
  if (hasBlockers) process.exit(1);
  process.exit(0);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) printHelp();

  const opts = parseArgs(args);
  if (opts.tracked) opts.files.push(...trackedProseFiles());
  if (opts.staged && opts.files.length === 0) {
    opts.files.push(...stagedProseFiles());
  }
  opts.files = [...new Set(opts.files)];
  if (opts.staged && opts.files.length === 0) process.exit(0);
  if (opts.files.length === 0) {
    console.error("prose-lint: no files specified");
    process.exit(1);
  }

  // Vale styles and agent skills are tooling definitions, not site content.
  // They contain the phrases that their rules and instructions discuss.
  const contentFiles = contentFilesOnly(opts.files);
  if (contentFiles.length === 0) process.exit(0);

  // Files staged as deletions no longer exist on disk; Vale can't lint
  // them, and their removal needs no prose review.
  const existingFiles = contentFiles.filter((f) => existsSync(f));
  if (existingFiles.length === 0) process.exit(0);

  const diffMode = opts.staged ? "cached" : opts.explicitDiff || "auto";
  const changedMap = buildChangedMap(
    existingFiles,
    opts.all,
    opts.base,
    diffMode,
  );
  const filtered = changedAlerts(
    runVale(existingFiles),
    changedMap,
    loadExemptions(),
  );
  reportAlerts(filtered, opts.reportOnly);
}

main();
