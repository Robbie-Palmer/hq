import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isSeq, parseDocument, type Document, type YAMLSeq } from "yaml";
import type { JsonValue, SharedManifestEdit } from "./contracts.js";

export const REPOSITORY_LAYOUT_PATH =
  "ui/content/projects/personal-engineering-platform/repository-layout.yaml";
export const PLATFORM_MANIFEST_PATH =
  "ui/content/projects/personal-engineering-platform/platform.yaml";
export const SHARED_MANIFEST_PATHS = new Set([
  ".mise.toml",
  "pnpm-workspace.yaml",
  REPOSITORY_LAYOUT_PATH,
  PLATFORM_MANIFEST_PATH,
]);

function parseYaml(source: string, manifestPath: string): Document {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(
      `Cannot edit ${manifestPath}: ${document.errors.map(({ message }) => message).join("; ")}`,
    );
  }
  return document;
}

function sequenceAt(
  document: Document,
  fieldPath: readonly string[],
  manifestPath: string,
): YAMLSeq {
  const sequence = document.getIn(fieldPath, true);
  if (!isSeq(sequence)) {
    throw new Error(
      `Cannot edit ${manifestPath}: '${fieldPath.join(".")}' is not a sequence`,
    );
  }
  return sequence;
}

function sequenceValues(sequence: YAMLSeq): JsonValue[] {
  return sequence.items.map((item) =>
    (item as { toJSON: () => JsonValue }).toJSON(),
  );
}

function upsertString(sequence: YAMLSeq, value: string): boolean {
  const values = sequenceValues(sequence);
  if (values.some((candidate) => candidate === value)) return false;
  sequence.flow = false;
  sequence.add(value);
  return true;
}

function upsertRecord(
  document: Document,
  sequence: YAMLSeq,
  value: Record<string, JsonValue>,
  expected: Record<string, JsonValue> | null,
  manifestPath: string,
): boolean {
  const values = sequenceValues(sequence);
  const index = values.findIndex(
    (candidate) =>
      candidate !== null &&
      !Array.isArray(candidate) &&
      typeof candidate === "object" &&
      candidate.id === value.id,
  );
  if (index === -1) {
    if (expected !== null) {
      throw new Error(
        `Cannot edit ${manifestPath}: expected record '${String(value.id)}' is absent`,
      );
    }
    sequence.flow = false;
    sequence.add(document.createNode(value));
    return true;
  }
  const current = values[index];
  if (isDeepStrictEqual(current, value)) return false;
  if (expected === null || !isDeepStrictEqual(current, expected)) {
    throw new Error(
      `Cannot edit ${manifestPath}: record '${String(value.id)}' has an unexpected current value`,
    );
  }
  sequence.items[index] = document.createNode(value);
  return true;
}

function addMiseConfigRoot(source: string, value: string): string {
  const section = /\[monorepo\]([\s\S]*?)(?:\n\[|$)/.exec(source)?.[1];
  if (!section) throw new Error("Cannot edit .mise.toml: missing [monorepo] section");
  const listPattern = /config_roots\s*=\s*\[([\s\S]*?)\]/;
  const list = listPattern.exec(section);
  if (!list) {
    throw new Error("Cannot edit .mise.toml: missing monorepo.config_roots array");
  }
  const configured = [...(list[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (configured.includes(value)) return source;
  const updatedSection = section.replace(
    listPattern,
    (matched) => matched.replace(/\n?\]$/, `\n    ${JSON.stringify(value)},\n]`),
  );
  return source.replace(section, updatedSection);
}

async function editYamlSequence(
  repositoryRoot: string,
  manifestPath: string,
  fieldPath: readonly string[],
  edit: SharedManifestEdit,
): Promise<boolean> {
  const absolutePath = path.join(repositoryRoot, manifestPath);
  const source = await readFile(absolutePath, "utf8");
  const document = parseYaml(source, manifestPath);
  const sequence = sequenceAt(document, fieldPath, manifestPath);
  let changed = false;
  if (edit.kind === "pnpm_workspace_package") {
    changed = upsertString(sequence, edit.value);
  } else if (edit.kind === "repository_project") {
    changed = upsertRecord(
      document,
      sequence,
      edit.value,
      edit.expected,
      manifestPath,
    );
  } else if (edit.kind === "catalog_record") {
    changed = upsertRecord(
      document,
      sequence,
      edit.value,
      edit.expected,
      manifestPath,
    );
  }
  if (changed) await writeFile(absolutePath, String(document), "utf8");
  return changed;
}

export function manifestPathForEdit(edit: SharedManifestEdit): string {
  switch (edit.kind) {
    case "mise_config_root":
      return ".mise.toml";
    case "pnpm_workspace_package":
      return "pnpm-workspace.yaml";
    case "repository_project":
      return REPOSITORY_LAYOUT_PATH;
    case "catalog_record":
      return PLATFORM_MANIFEST_PATH;
  }
}

export async function applySharedManifestEdits(
  repositoryRoot: string,
  edits: readonly SharedManifestEdit[],
): Promise<string[]> {
  const changedPaths: string[] = [];
  for (const edit of edits) {
    const manifestPath = manifestPathForEdit(edit);
    let changed: boolean;
    if (edit.kind === "mise_config_root") {
      const absolutePath = path.join(repositoryRoot, manifestPath);
      const source = await readFile(absolutePath, "utf8");
      const updated = addMiseConfigRoot(source, edit.value);
      changed = source !== updated;
      if (changed) await writeFile(absolutePath, updated, "utf8");
    } else if (edit.kind === "pnpm_workspace_package") {
      changed = await editYamlSequence(
        repositoryRoot,
        manifestPath,
        ["packages"],
        edit,
      );
    } else if (edit.kind === "repository_project") {
      changed = await editYamlSequence(
        repositoryRoot,
        manifestPath,
        ["projects"],
        edit,
      );
    } else {
      changed = await editYamlSequence(
        repositoryRoot,
        manifestPath,
        ["catalog", "records"],
        edit,
      );
    }
    if (changed) changedPaths.push(manifestPath);
  }
  return changedPaths;
}
