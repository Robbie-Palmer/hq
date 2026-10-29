import { z } from "zod";

export const REVIEW_RULE_PREVIEW_SCHEMA_VERSION = 1 as const;
export const REVIEW_RULE_RESOLVER_VERSION = "layered-review-rules-v1";
export const DEFAULT_REVIEW_RULE_SET_VERSION = "production-review-rules-v1";

export const ReviewRuleLayerSchema = z.enum([
  "global",
  "repository",
  "directory",
  "language",
  "file",
]);
export type ReviewRuleLayer = z.infer<typeof ReviewRuleLayerSchema>;

export const ReviewRuleSourceSchema = z.object({
  kind: z.enum(["builtin", "configuration", "repository"]),
  reference: z.string().min(1),
  revision: z.string().min(1).optional(),
}).strict();
export type ReviewRuleSource = z.infer<typeof ReviewRuleSourceSchema>;

export const ReviewRuleScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({
    kind: z.literal("repository"),
    repository: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("directory"),
    directory: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("language"),
    language: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("file"),
    path: z.string().min(1),
  }).strict(),
]);
export type ReviewRuleScope = z.infer<typeof ReviewRuleScopeSchema>;

export const ReviewRuleDefinitionSchema = z.object({
  ruleId: z.string().min(1),
  key: z.string().min(1),
  instruction: z.string().min(1),
  scope: ReviewRuleScopeSchema,
  source: ReviewRuleSourceSchema,
}).strict();
export type ReviewRuleDefinition = z.infer<typeof ReviewRuleDefinitionSchema>;

export const ReviewRuleSetSchema = z.object({
  schemaVersion: z.literal(REVIEW_RULE_PREVIEW_SCHEMA_VERSION),
  ruleSetVersion: z.string().min(1),
  rules: z.array(ReviewRuleDefinitionSchema),
}).strict();
export type ReviewRuleSet = z.infer<typeof ReviewRuleSetSchema>;

export const EffectiveReviewRuleSchema = z.object({
  key: z.string().min(1),
  instruction: z.string().min(1),
  layer: ReviewRuleLayerSchema,
  ruleIds: z.array(z.string().min(1)).min(1),
  sources: z.array(ReviewRuleSourceSchema).min(1),
}).strict();
export type EffectiveReviewRule = z.infer<typeof EffectiveReviewRuleSchema>;

export const ReviewRuleConflictSchema = z.object({
  path: z.string().min(1),
  key: z.string().min(1),
  layer: ReviewRuleLayerSchema,
  candidates: z.array(EffectiveReviewRuleSchema).min(2),
}).strict();
export type ReviewRuleConflict = z.infer<typeof ReviewRuleConflictSchema>;

export const ReviewRulePathPreviewSchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1).optional(),
  effectiveRules: z.array(EffectiveReviewRuleSchema),
}).strict();
export type ReviewRulePathPreview = z.infer<typeof ReviewRulePathPreviewSchema>;

export const ReviewRulePreviewSchema = z.object({
  schemaVersion: z.literal(REVIEW_RULE_PREVIEW_SCHEMA_VERSION),
  resolverVersion: z.literal(REVIEW_RULE_RESOLVER_VERSION),
  ruleSetVersion: z.string().min(1),
  paths: z.array(ReviewRulePathPreviewSchema),
  conflicts: z.array(ReviewRuleConflictSchema),
}).strict();
export type ReviewRulePreview = z.infer<typeof ReviewRulePreviewSchema>;

const LAYER_RANK: Readonly<Record<ReviewRuleLayer, number>> = {
  global: 0,
  repository: 1,
  directory: 2,
  language: 3,
  file: 4,
};

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shell",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
};

function assertRepositoryPath(path: string, label: string): void {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a normalized repository-relative path: ${path}`);
  }
}

function directoryDepth(directory: string): number {
  return directory === "." ? 0 : directory.split("/").length;
}

function directoryMatches(path: string, directory: string): boolean {
  return directory === "." || path.startsWith(`${directory}/`);
}

export function reviewLanguageForPath(path: string): string | undefined {
  assertRepositoryPath(path, "Review path");
  const filename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (filename === "dockerfile") return "dockerfile";
  const extensionIndex = filename.lastIndexOf(".");
  if (extensionIndex < 0) return undefined;
  return LANGUAGE_BY_EXTENSION[filename.slice(extensionIndex + 1)];
}

function ruleSpecificity(rule: ReviewRuleDefinition): number {
  return rule.scope.kind === "directory"
    ? directoryDepth(rule.scope.directory)
    : 0;
}

function ruleMatches(
  rule: ReviewRuleDefinition,
  repository: string,
  path: string,
  language: string | undefined,
): boolean {
  switch (rule.scope.kind) {
    case "global":
      return true;
    case "repository":
      return rule.scope.repository === repository;
    case "directory":
      return directoryMatches(path, rule.scope.directory);
    case "language":
      return rule.scope.language === language;
    case "file":
      return rule.scope.path === path;
  }
}

function sourceKey(source: ReviewRuleSource): string {
  return [source.kind, source.reference, source.revision ?? ""].join("\0");
}

function sortedSources(rules: ReviewRuleDefinition[]): ReviewRuleSource[] {
  const sources = new Map<string, ReviewRuleSource>();
  for (const rule of rules) sources.set(sourceKey(rule.source), rule.source);
  return [...sources.values()].sort((left, right) =>
    sourceKey(left).localeCompare(sourceKey(right)),
  );
}

function effectiveRule(
  rules: ReviewRuleDefinition[],
  instruction: string,
): EffectiveReviewRule {
  const first = rules[0];
  if (!first) throw new Error("Cannot resolve an empty rule group");
  return {
    key: first.key,
    instruction,
    layer: first.scope.kind,
    ruleIds: rules.map(({ ruleId }) => ruleId).sort((left, right) =>
      left.localeCompare(right),
    ),
    sources: sortedSources(rules),
  };
}

function validateRuleSet(ruleSet: ReviewRuleSet): ReviewRuleSet {
  const parsed = ReviewRuleSetSchema.parse(ruleSet);
  const ids = new Set<string>();
  for (const rule of parsed.rules) {
    if (ids.has(rule.ruleId)) {
      throw new Error(`Duplicate review rule ID: ${rule.ruleId}`);
    }
    ids.add(rule.ruleId);
    if (rule.scope.kind === "directory") {
      if (rule.scope.directory !== ".") {
        assertRepositoryPath(rule.scope.directory, `Directory scope for ${rule.ruleId}`);
      }
    } else if (rule.scope.kind === "file") {
      assertRepositoryPath(rule.scope.path, `File scope for ${rule.ruleId}`);
    }
  }
  return parsed;
}

function resolvePath(
  repository: string,
  path: string,
  rules: ReviewRuleDefinition[],
): { preview: ReviewRulePathPreview; conflicts: ReviewRuleConflict[] } {
  const language = reviewLanguageForPath(path);
  const matches = rules.filter((rule) =>
    ruleMatches(rule, repository, path, language),
  );
  const byKey = new Map<string, ReviewRuleDefinition[]>();
  for (const rule of matches) {
    byKey.set(rule.key, [...(byKey.get(rule.key) ?? []), rule]);
  }
  const effectiveRules: EffectiveReviewRule[] = [];
  const conflicts: ReviewRuleConflict[] = [];
  for (const [key, candidates] of [...byKey].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const winningRank = Math.max(
      ...candidates.map((rule) => LAYER_RANK[rule.scope.kind]),
    );
    const ranked = candidates.filter(
      (rule) => LAYER_RANK[rule.scope.kind] === winningRank,
    );
    const winningSpecificity = Math.max(...ranked.map(ruleSpecificity));
    const winners = ranked.filter(
      (rule) => ruleSpecificity(rule) === winningSpecificity,
    );
    const byInstruction = new Map<string, ReviewRuleDefinition[]>();
    for (const rule of winners) {
      byInstruction.set(rule.instruction, [
        ...(byInstruction.get(rule.instruction) ?? []),
        rule,
      ]);
    }
    if (byInstruction.size === 1) {
      const [instruction, agreeingRules] = [...byInstruction][0] ?? [];
      if (instruction && agreeingRules) {
        effectiveRules.push(effectiveRule(agreeingRules, instruction));
      }
      continue;
    }
    conflicts.push({
      path,
      key,
      layer: winners[0]?.scope.kind ?? "global",
      candidates: [...byInstruction]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([instruction, instructionRules]) =>
          effectiveRule(instructionRules, instruction),
        ),
    });
  }
  return {
    preview: {
      path,
      ...(language ? { language } : {}),
      effectiveRules,
    },
    conflicts,
  };
}

export function previewReviewRules(options: {
  repository: string;
  paths: string[];
  ruleSet: ReviewRuleSet;
}): ReviewRulePreview {
  const ruleSet = validateRuleSet(options.ruleSet);
  const uniquePaths = [...new Set(options.paths)].sort((left, right) =>
    left.localeCompare(right),
  );
  const resolutions = uniquePaths.map((path) =>
    resolvePath(options.repository, path, ruleSet.rules),
  );
  return ReviewRulePreviewSchema.parse({
    schemaVersion: REVIEW_RULE_PREVIEW_SCHEMA_VERSION,
    resolverVersion: REVIEW_RULE_RESOLVER_VERSION,
    ruleSetVersion: ruleSet.ruleSetVersion,
    paths: resolutions.map(({ preview }) => preview),
    conflicts: resolutions.flatMap(({ conflicts }) => conflicts),
  });
}

export class ReviewRuleConflictError extends Error {
  constructor(readonly preview: ReviewRulePreview) {
    const locations = preview.conflicts.map(({ path, key }) => `${path}:${key}`);
    super(`Unresolved review rule conflicts: ${locations.join(", ")}`);
    this.name = "ReviewRuleConflictError";
  }
}

export function assertReviewRulePreviewResolved(
  preview: ReviewRulePreview,
  expectedPaths: string[] = [],
): void {
  const parsed = ReviewRulePreviewSchema.parse(preview);
  if (parsed.conflicts.length > 0) throw new ReviewRuleConflictError(parsed);
  const previewPaths = new Set(parsed.paths.map(({ path }) => path));
  const missingPaths = [...new Set(expectedPaths)]
    .filter((path) => !previewPaths.has(path))
    .sort((left, right) => left.localeCompare(right));
  if (missingPaths.length > 0) {
    throw new Error(
      `Review rule preview is missing selected paths: ${missingPaths.join(", ")}`,
    );
  }
}

export function resolveReviewRules(options: {
  repository: string;
  paths: string[];
  ruleSet: ReviewRuleSet;
}): ReviewRulePreview {
  const preview = previewReviewRules(options);
  assertReviewRulePreviewResolved(preview);
  return preview;
}

export function productionReviewRuleSet(options: {
  repository: string;
  headSha: string;
  repositoryGuidelines: string;
  repositoryGuidelineSource?: string;
}): ReviewRuleSet {
  const rules: ReviewRuleDefinition[] = [
    {
      ruleId: "builtin:concrete-defects",
      key: "review-focus",
      instruction:
        "Report concrete correctness, security, reliability, data-loss, concurrency, and material performance defects. Ignore style and speculative concerns.",
      scope: { kind: "global" },
      source: {
        kind: "builtin",
        reference: "ai-review-domain/reviewer",
        revision: DEFAULT_REVIEW_RULE_SET_VERSION,
      },
    },
  ];
  if (options.repositoryGuidelines.trim()) {
    rules.push({
      ruleId: `repository:${options.repository}:guidelines`,
      key: "repository-guidelines",
      instruction: options.repositoryGuidelines,
      scope: { kind: "repository", repository: options.repository },
      source: {
        kind: "repository",
        reference:
          options.repositoryGuidelineSource ?? "repository-guidelines",
        revision: options.headSha,
      },
    });
  }
  return {
    schemaVersion: REVIEW_RULE_PREVIEW_SCHEMA_VERSION,
    ruleSetVersion: DEFAULT_REVIEW_RULE_SET_VERSION,
    rules,
  };
}

export function renderReviewRulePreview(preview: ReviewRulePreview): string {
  assertReviewRulePreviewResolved(preview);
  return JSON.stringify({
    resolverVersion: preview.resolverVersion,
    ruleSetVersion: preview.ruleSetVersion,
    paths: preview.paths,
  });
}
