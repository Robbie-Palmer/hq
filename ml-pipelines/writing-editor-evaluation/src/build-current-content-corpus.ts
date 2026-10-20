import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { canonicalJson } from "writing-editor-domain/canonical-json";
import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { resetDirectory, writeJson } from "./files";
import { FrozenCohortSchema, PipelineParamsSchema } from "./schemas";

const ContentKindSchema = z.enum([
  "blog",
  "idea",
  "initiative",
  "project-page",
  "pitch",
  "adr",
  "developer-doc",
]);
type ContentKind = z.infer<typeof ContentKindSchema>;
const ContentAudienceSchema = z.enum(["customer", "developer"]);
type ContentAudience = z.infer<typeof ContentAudienceSchema>;

const CurrentContentEntrySchema = z.object({
  artifactId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: ContentKindSchema,
  path: z.string().min(1),
  file: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
}).strict();

export const CurrentContentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-current-content-corpus"),
  audience: ContentAudienceSchema,
  datasetId: z.string().regex(/^dataset:v1:[a-f0-9]{64}$/),
  revision: z.union([
    z.string().regex(/^worktree:[a-f0-9]{64}$/),
    z.string().regex(/^[a-f0-9]{40}$/),
  ]),
  entries: z.array(CurrentContentEntrySchema).min(1),
  calibrationArtifactIds: z.array(z.string()).min(1),
}).strict().superRefine((manifest, context) => {
  const firstPathByArtifactId = new Map<string, string>();
  manifest.entries.forEach((entry, index) => {
    const firstPath = firstPathByArtifactId.get(entry.artifactId);
    if (firstPath !== undefined) {
      context.addIssue({
        code: "custom",
        message: `artifact ID ${entry.artifactId} collides between ${firstPath} and ${entry.path}`,
        path: ["entries", index, "artifactId"],
      });
      return;
    }
    firstPathByArtifactId.set(entry.artifactId, entry.path);
  });
});

const CliOptionsSchema = z.object({
  repository: z.string().trim().min(1),
  params: z.string().trim().min(1),
  output: z.string().trim().min(1),
  audience: ContentAudienceSchema,
  revision: z.string().trim().min(1).optional(),
}).strict();

interface SelectedFile {
  artifactId: string;
  kind: ContentKind;
  path: string;
  absolutePath?: string;
}

const gitExecutable = "/usr/bin/git";

function compareAscending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const candidate = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(candidate) : [candidate];
    })
    .sort(compareAscending);
}

function pathId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/\.(?:md|mdx)$/u, "")
    .replace(/[^a-z0-9]+/gu, "-");

  return normalized.split("-").filter(Boolean).join("-");
}

function classifyPublic(relativePath: string): ContentKind | undefined {
  const parts = relativePath.split("/");
  if (parts.length === 2 && parts[1]?.endsWith(".mdx")) {
    if (parts[0] === "blog") return "blog";
    if (parts[0] === "ideas") return "idea";
    if (parts[0] === "initiatives") return "initiative";
  }
  if (parts.length === 3 && parts[0] === "projects") {
    if (parts[2] === "index.mdx") return "project-page";
    if (parts[2] === "pitch.mdx") return "pitch";
  }
  return undefined;
}

function artifactId(kind: ContentKind, relativePath: string): string {
  if (kind === "project-page") {
    return `project-${pathId(relativePath.replace(/^projects\//u, "").replace(/\/index\.mdx$/u, ""))}`;
  }
  if (kind === "pitch") {
    return `pitch-${pathId(relativePath.replace(/^projects\//u, "").replace(/\/pitch\.mdx$/u, ""))}`;
  }
  return `${kind}-${pathId(path.basename(relativePath))}`;
}

function trackedMarkdown(repository: string, revision?: string): string[] {
  const args = revision
    ? ["ls-tree", "-r", "--name-only", revision]
    : ["ls-files", "*.md", "*.mdx"];
  return execFileSync(gitExecutable, args, { cwd: repository, encoding: "utf8" })
    .trim().split("\n").filter((file) => /\.mdx?$/u.test(file)).sort(compareAscending);
}

function selectedPublicFiles(repository: string, revision?: string): SelectedFile[] {
  if (revision) {
    return trackedMarkdown(repository, revision).flatMap((repositoryPath) => {
      const relativePath = repositoryPath.replace(/^ui\/content\//u, "");
      if (relativePath === repositoryPath) return [];
      const kind = classifyPublic(relativePath);
      if (kind === undefined) return [];
      return [{
        artifactId: artifactId(kind, relativePath),
        kind,
        path: repositoryPath,
      }];
    });
  }
  const contentRoot = path.join(repository, "ui/content");
  return walk(contentRoot).flatMap((absolutePath) => {
    const relativePath = path.relative(contentRoot, absolutePath).split(path.sep).join("/");
    const kind = classifyPublic(relativePath);
    if (kind === undefined) return [];
    return [{
      artifactId: artifactId(kind, relativePath),
      kind,
      path: `ui/content/${relativePath}`,
      absolutePath,
    }];
  });
}

const developerExclusions = [
  /^\.claude\//u,
  /^\.vale\/styles\/(?:proselint|write-good)\//u,
  /(?:^|\/)third_party\//u,
  /(?:^|\/)source-snapshots\//u,
  /(?:^|\/)DATA-LICENCE\.md$/u,
];

function selectedDeveloperFiles(repository: string, revision?: string): SelectedFile[] {
  return trackedMarkdown(repository, revision).flatMap((relativePath) => {
    const contentPath = relativePath.replace(/^ui\/content\//u, "");
    if (classifyPublic(contentPath) !== undefined) return [];
    if (developerExclusions.some((pattern) => pattern.test(relativePath))) return [];
    const kind: ContentKind = /\/adrs\/[^/]+\.mdx$/u.test(relativePath)
      ? "adr"
      : "developer-doc";
    return [{
      artifactId: `${kind}-${pathId(relativePath)}`,
      kind,
      path: relativePath,
      ...(revision ? {} : { absolutePath: path.join(repository, relativePath) }),
    }];
  });
}

function selectedFiles(
  repository: string,
  audience: ContentAudience,
  revision?: string,
): SelectedFile[] {
  if (audience === "customer") return selectedPublicFiles(repository, revision);
  return selectedDeveloperFiles(repository, revision);
}

function readSelectedContent(
  repository: string,
  revision: string | undefined,
  file: SelectedFile,
): string {
  if (revision) {
    return execFileSync(gitExecutable, ["show", `${revision}:${file.path}`], {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  if (!file.absolutePath) throw new Error(`${file.path} has no worktree path`);
  return fs.readFileSync(file.absolutePath, "utf8");
}

function calibrationIds(
  files: Array<Pick<SelectedFile, "artifactId" | "kind">>,
  seed: string,
  perKind: number,
): string[] {
  const kinds = ContentKindSchema.options;
  return kinds.flatMap((kind) => files
    .filter((file) => file.kind === kind)
    .map((file) => ({ file, rank: sha256(`${seed}\0${kind}\0${file.artifactId}`) }))
    .sort((left, right) => compareAscending(left.rank, right.rank))
    .slice(0, perKind)
    .map(({ file }) => file.artifactId));
}

function cohort(
  entries: z.infer<typeof CurrentContentEntrySchema>[],
  selectedIds: Set<string>,
  datasetId: string,
  revision: string,
  frozenAt: string,
  seed: string,
) {
  const selected = entries.filter(({ artifactId }) => selectedIds.has(artifactId));
  const digest = sha256(canonicalJson({
    datasetId,
    revision,
    seed,
    artifactIds: selected.map(({ artifactId }) => artifactId),
  })).slice("sha256:".length);
  return FrozenCohortSchema.parse({
    schemaVersion: 1,
    recordType: "writing-editor-frozen-cohort",
    cohortId: `cohort:v1:${digest}`,
    datasetId,
    frozenAt,
    seed,
    splitRatios: { train: 0.6, validation: 0.2, holdout: 0.2 },
    entries: selected.map((entry) => {
      const source = {
        revision,
        committedAt: frozenAt,
        contentHash: entry.contentHash,
        bytes: entry.bytes,
        file: entry.file,
      };
      return {
        artifactId: entry.artifactId,
        artifactType: entry.kind === "adr" ? "adr" : "project-page",
        path: entry.path,
        outcomeStatus: "unrecorded",
        split: "validation",
        source,
        published: source,
      };
    }),
  });
}

export function buildCurrentContentCorpus(options: {
  repository: string;
  paramsFile: string;
  output: string;
  outputRoot: string;
  audience: ContentAudience;
  revision?: string;
}): z.infer<typeof CurrentContentManifestSchema> {
  const repository = fs.realpathSync(options.repository);
  const params = PipelineParamsSchema.parse(
    JSON.parse(fs.readFileSync(options.paramsFile, "utf8")),
  );
  const revision = options.revision
    ? execFileSync(gitExecutable, ["rev-parse", `${options.revision}^{commit}`], {
      cwd: repository,
      encoding: "utf8",
    }).trim()
    : undefined;
  const files = selectedFiles(repository, options.audience, revision);
  const prepared = files.map((file) => {
    const content = readSelectedContent(repository, revision, file);
    const extension = path.extname(file.path);
    return {
      ...file,
      content,
      entry: {
        artifactId: file.artifactId,
        kind: file.kind,
        path: file.path,
        file: `artifacts/${file.artifactId}/source${extension}`,
        contentHash: sha256(content),
        bytes: Buffer.byteLength(content),
      },
    };
  });
  const identities = prepared.map(({ entry }) => ({
    artifactId: entry.artifactId,
    kind: entry.kind,
    path: entry.path,
    contentHash: entry.contentHash,
  }));
  const digest = sha256(canonicalJson(identities)).slice("sha256:".length);
  const datasetId = `dataset:v1:${digest}`;
  const sourceRevision = revision ?? `worktree:${digest}`;
  const calibrationArtifactIds = calibrationIds(
    prepared,
    params.cohort.seed,
    options.audience === "customer" ? 4 : 10,
  );
  const manifest = CurrentContentManifestSchema.parse({
    schemaVersion: 1,
    recordType: "writing-editor-current-content-corpus",
    audience: options.audience,
    datasetId,
    revision: sourceRevision,
    entries: prepared.map(({ entry }) => entry),
    calibrationArtifactIds,
  });

  resetDirectory(options.output, options.outputRoot);
  for (const { content, entry } of prepared) {
    const destination = path.join(options.output, entry.file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  writeJson(path.join(options.output, "manifest.json"), manifest);
  writeJson(path.join(options.output, "cohort.json"), cohort(
    manifest.entries,
    new Set(manifest.entries.map(({ artifactId }) => artifactId)),
    datasetId,
    sourceRevision,
    params.cohort.frozenAt,
    `${params.cohort.seed}-full`,
  ));
  writeJson(path.join(options.output, "calibration-cohort.json"), cohort(
    manifest.entries,
    new Set(calibrationArtifactIds),
    datasetId,
    sourceRevision,
    params.cohort.frozenAt,
    `${params.cohort.seed}-calibration`,
  ));
  return manifest;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      repository: { type: "string" },
      params: { type: "string" },
      output: { type: "string" },
      audience: { type: "string" },
      revision: { type: "string" },
    },
  });
  const args = CliOptionsSchema.parse(values);
  const manifest = buildCurrentContentCorpus({
    repository: args.repository,
    paramsFile: args.params,
    output: args.output,
    outputRoot: path.resolve("."),
    audience: args.audience,
    revision: args.revision,
  });
  const counts = Object.fromEntries(ContentKindSchema.options.map((kind) => [
    kind,
    manifest.entries.filter((entry) => entry.kind === kind).length,
  ]));
  console.log(
    `Captured ${manifest.entries.length} current content pages (${JSON.stringify(counts)})`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
