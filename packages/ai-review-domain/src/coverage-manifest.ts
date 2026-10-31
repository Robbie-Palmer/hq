import { z } from "zod";

export const REVIEW_COVERAGE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const DEFAULT_REVIEW_SELECTOR_VERSION = "default-path-selector-v1";

export const ReviewPathDecisionSchema = z.enum([
  "selected",
  "excluded",
  "completed",
  "failed",
  "waived",
]);
export type ReviewPathDecision = z.infer<typeof ReviewPathDecisionSchema>;

export const ReviewPathReasonCodeSchema = z.enum([
  "default-included",
  "forced-inclusion",
  "configured-filename-exclusion",
  "configured-extension-exclusion",
  "configured-directory-exclusion",
  "configured-vendor-exclusion",
  "configured-generated-exclusion",
  "review-completed",
  "review-run-failed",
  "review-failed-diff-unavailable",
  "review-waived-no-semantic-change",
  "review-waived-prior-coverage",
  "review-waived-policy-denied",
  "review-waived-no-model-review",
]);
export type ReviewPathReasonCode = z.infer<typeof ReviewPathReasonCodeSchema>;

const REASON_CODES_BY_DECISION: Readonly<
  Record<ReviewPathDecision, ReadonlySet<ReviewPathReasonCode>>
> = {
  selected: new Set(["default-included", "forced-inclusion"]),
  excluded: new Set([
    "configured-filename-exclusion",
    "configured-extension-exclusion",
    "configured-directory-exclusion",
    "configured-vendor-exclusion",
    "configured-generated-exclusion",
  ]),
  completed: new Set(["review-completed"]),
  failed: new Set(["review-run-failed", "review-failed-diff-unavailable"]),
  waived: new Set([
    "review-waived-no-semantic-change",
    "review-waived-prior-coverage",
    "review-waived-policy-denied",
    "review-waived-no-model-review",
  ]),
};

export const ReviewPathCoverageSchema = z.object({
  path: z.string().min(1),
  decision: ReviewPathDecisionSchema,
  reasonCode: ReviewPathReasonCodeSchema,
}).strict().superRefine((entry, context) => {
  if (!REASON_CODES_BY_DECISION[entry.decision].has(entry.reasonCode)) {
    context.addIssue({
      code: "custom",
      message: `${entry.reasonCode} is not valid for ${entry.decision}`,
      path: ["reasonCode"],
    });
  }
});
export type ReviewPathCoverage = z.infer<typeof ReviewPathCoverageSchema>;

const ReviewCoverageSummarySchema = z.object({
  selected: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  waived: z.number().int().nonnegative(),
}).strict();

export const ReviewCoverageManifestSchema = z.object({
  schemaVersion: z.literal(REVIEW_COVERAGE_MANIFEST_SCHEMA_VERSION),
  selectorVersion: z.string().min(1),
  paths: z.array(ReviewPathCoverageSchema),
  summary: ReviewCoverageSummarySchema,
}).strict().superRefine((manifest, context) => {
  const paths = manifest.paths.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    context.addIssue({
      code: "custom",
      message: "coverage manifest paths must be unique",
      path: ["paths"],
    });
  }
  const sorted = [...paths].sort((left, right) => left.localeCompare(right));
  if (paths.some((path, index) => path !== sorted[index])) {
    context.addIssue({
      code: "custom",
      message: "coverage manifest paths must be sorted",
      path: ["paths"],
    });
  }
  const expected = coverageSummary(manifest.paths);
  for (const decision of ReviewPathDecisionSchema.options) {
    if (manifest.summary[decision] !== expected[decision]) {
      context.addIssue({
        code: "custom",
        message: `coverage manifest summary does not match ${decision} paths`,
        path: ["summary", decision],
      });
    }
  }
});
export type ReviewCoverageManifest = z.infer<typeof ReviewCoverageManifestSchema>;

export interface ReviewSelectionPolicy {
  version: string;
  excludedFilenames: ReadonlySet<string>;
  excludedExtensions: readonly string[];
  excludedDirectories: ReadonlySet<string>;
  excludedVendorPrefixes: readonly string[];
  excludedGeneratedPrefixes: readonly string[];
  excludedGeneratedFiles: ReadonlySet<string>;
}

const EXCLUDED_FILENAMES = new Set([
  ".terraform.lock.hcl",
  ".ds_store",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "gradle.lockfile",
  "mix.lock",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.resolved",
  "packages.lock.json",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "pubspec.lock",
  "uv.lock",
  "yarn.lock",
  "thumbs.db",
]);

const EXCLUDED_EXTENSIONS = [
  ".7z", ".a", ".arrow", ".avi", ".avif", ".bin", ".bmp", ".bz2", ".class", ".ckpt",
  ".db", ".dll", ".dmg", ".doc", ".docx", ".dylib", ".eot", ".exe", ".feather",
  ".cer", ".crt", ".flac", ".gif", ".gz", ".h5", ".heic", ".ico", ".jar", ".jpeg",
  ".jpg", ".key", ".lib", ".lock", ".lockb", ".m4a", ".map", ".mkv", ".mov", ".mp3",
  ".mp4", ".npy", ".npz", ".o", ".obj", ".onnx", ".otf", ".parquet", ".pdf", ".pickle",
  ".pkl", ".png", ".ppt", ".pptx", ".p12", ".pfx", ".pem", ".psd", ".pt", ".pth",
  ".pyc", ".rar", ".safetensors", ".snap", ".so", ".sqlite", ".sqlite3", ".svg", ".tar",
  ".tfstate", ".tif", ".tiff", ".ttf", ".wasm", ".wav", ".webm", ".webp", ".woff",
  ".woff2", ".xls", ".xlsx", ".xz", ".zip", ".zst",
];

const EXCLUDED_DIRECTORIES = new Set([
  ".cache",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".terraform",
  ".turbo",
  ".venv",
  "__generated__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
  "vendor",
]);

export const DEFAULT_REVIEW_SELECTION_POLICY: ReviewSelectionPolicy = {
  version: DEFAULT_REVIEW_SELECTOR_VERSION,
  excludedFilenames: EXCLUDED_FILENAMES,
  excludedExtensions: EXCLUDED_EXTENSIONS,
  excludedDirectories: EXCLUDED_DIRECTORIES,
  excludedVendorPrefixes: [
    ".vale/styles/proselint/",
    ".vale/styles/write-good/",
  ],
  excludedGeneratedPrefixes: [
    "packages/work-graph-db/drizzle/meta/",
    "workers/recipe-api/drizzle/meta/",
    "packages/work-graph-cli/src/generated/",
  ],
  excludedGeneratedFiles: new Set([
    "workers/recipe-api/openapi.json",
    "workers/work-graph-api/openapi.json",
  ]),
};

function coverageSummary(
  paths: readonly Pick<ReviewPathCoverage, "decision">[],
): Record<ReviewPathDecision, number> {
  const summary: Record<ReviewPathDecision, number> = {
    selected: 0,
    excluded: 0,
    completed: 0,
    failed: 0,
    waived: 0,
  };
  for (const { decision } of paths) summary[decision] += 1;
  return summary;
}

function excludedReason(
  path: string,
  policy: ReviewSelectionPolicy,
): ReviewPathReasonCode | undefined {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts.at(-1) ?? normalized;
  if (policy.excludedVendorPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return "configured-vendor-exclusion";
  }
  if (
    policy.excludedGeneratedPrefixes.some((prefix) => normalized.startsWith(prefix)) ||
    policy.excludedGeneratedFiles.has(normalized) ||
    basename.includes(".generated.") ||
    basename.endsWith(".min.css") ||
    basename.endsWith(".min.js")
  ) {
    return "configured-generated-exclusion";
  }
  if (
    policy.excludedFilenames.has(basename) ||
    basename === ".env" ||
    basename.startsWith(".env.")
  ) {
    return "configured-filename-exclusion";
  }
  if (policy.excludedExtensions.some((extension) => basename.endsWith(extension))) {
    return "configured-extension-exclusion";
  }
  if (parts.slice(0, -1).some((directory) => policy.excludedDirectories.has(directory))) {
    return "configured-directory-exclusion";
  }
  return undefined;
}

function manifest(
  selectorVersion: string,
  paths: ReviewPathCoverage[],
): ReviewCoverageManifest {
  const sorted = [...paths].sort((left, right) => left.path.localeCompare(right.path));
  return ReviewCoverageManifestSchema.parse({
    schemaVersion: REVIEW_COVERAGE_MANIFEST_SCHEMA_VERSION,
    selectorVersion,
    paths: sorted,
    summary: coverageSummary(sorted),
  });
}

export function selectReviewPaths(
  changedPaths: readonly string[],
  options: {
    force?: boolean;
    policy?: ReviewSelectionPolicy;
  } = {},
): ReviewCoverageManifest {
  const policy = options.policy ?? DEFAULT_REVIEW_SELECTION_POLICY;
  const paths = [...new Set(changedPaths)].map((path): ReviewPathCoverage => {
    const reasonCode = excludedReason(path, policy);
    if (!options.force && reasonCode) {
      return { path, decision: "excluded", reasonCode };
    }
    return {
      path,
      decision: "selected",
      reasonCode: options.force && reasonCode ? "forced-inclusion" : "default-included",
    };
  });
  return manifest(policy.version, paths);
}

export function reviseReviewPathDecisions(
  current: ReviewCoverageManifest,
  revisions: ReadonlyMap<string, Pick<ReviewPathCoverage, "decision" | "reasonCode">>,
): ReviewCoverageManifest {
  const parsed = ReviewCoverageManifestSchema.parse(current);
  const knownPaths = new Set(parsed.paths.map(({ path }) => path));
  for (const path of revisions.keys()) {
    if (!knownPaths.has(path)) throw new Error(`Unknown review coverage path: ${path}`);
  }
  return manifest(
    parsed.selectorVersion,
    parsed.paths.map((entry) => {
      const revision = revisions.get(entry.path);
      if (!revision || entry.decision === "excluded") return entry;
      return { path: entry.path, ...revision };
    }),
  );
}

export function finalizeReviewCoverageManifest(
  current: ReviewCoverageManifest,
  status: "published" | "skipped" | "denied" | "failed",
): ReviewCoverageManifest {
  let terminal: Pick<ReviewPathCoverage, "decision" | "reasonCode">;
  if (status === "published") {
    terminal = { decision: "completed", reasonCode: "review-completed" };
  } else if (status === "failed") {
    terminal = { decision: "failed", reasonCode: "review-run-failed" };
  } else if (status === "denied") {
    terminal = { decision: "waived", reasonCode: "review-waived-policy-denied" };
  } else {
    terminal = { decision: "waived", reasonCode: "review-waived-no-model-review" };
  }
  return reviseReviewPathDecisions(
    current,
    new Map(
      current.paths
        .filter(({ decision }) => decision === "selected")
        .map(({ path }) => [path, terminal]),
    ),
  );
}

export function reviewPathIsExcluded(
  path: string,
  policy: ReviewSelectionPolicy = DEFAULT_REVIEW_SELECTION_POLICY,
): boolean {
  return excludedReason(path, policy) !== undefined;
}
