import fs from "node:fs";
import path from "node:path";

import { canonicalJson } from "writing-editor-domain/canonical-json";

export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read JSON ${file}: ${errorMessage(error)}`);
  }
}

export function resolveContainedFile(
  rootDirectory: string,
  relativeFile: string,
  label: string,
): string {
  const root = path.resolve(rootDirectory);
  const file = path.resolve(root, relativeFile);
  assertContained(root, file, label);

  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(file);
    assertContained(realRoot, realFile, label);
    return realFile;
  } catch (error) {
    throw new Error(`cannot resolve ${label} ${file}: ${errorMessage(error)}`);
  }
}

export function readContainedText(
  rootDirectory: string,
  relativeFile: string,
  label: string,
): string {
  const file = resolveContainedFile(rootDirectory, relativeFile, label);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${label} ${file}: ${errorMessage(error)}`);
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${canonicalJson(value)}\n`);
}

export function resetDirectory(directory: string, allowedRoot: string): void {
  const resolved = resolveSafeOutputDirectory(directory, allowedRoot);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

export function ensureOutputDirectory(directory: string, allowedRoot: string): void {
  const resolved = resolveSafeOutputDirectory(directory, allowedRoot);
  fs.mkdirSync(resolved, { recursive: true });
}

function resolveSafeOutputDirectory(directory: string, allowedRoot: string): string {
  const resolved = path.resolve(directory);
  const root = path.resolve(allowedRoot);
  const relative = path.relative(root, resolved);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`refusing to reset unsafe output directory: ${resolved}`);
  }
  assertNoSymlinkComponents(root, relative);
  return resolved;
}

function assertNoSymlinkComponents(root: string, relative: string): void {
  let current = root;
  for (const segment of ["", ...relative.split(path.sep)]) {
    current = path.join(current, segment);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`refusing to reset output through symbolic link: ${current}`);
    }
  }
}

function assertContained(root: string, file: string, label: string): void {
  const relative = path.relative(root, file);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must resolve to a file within ${root}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
