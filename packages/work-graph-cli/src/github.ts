import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { PullRequestSnapshot } from "./generated/client/types.gen.js";
import { CliError, EXIT_CODES, usageError } from "./errors.js";
import { withoutWorkGraphCredentials } from "./self-update.js";

const execFileAsync = promisify(execFile);

const githubPullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.url(),
  headRefOid: z.string().regex(/^[0-9a-f]{40}$/iu),
  mergeCommit: z.union([
    z.object({ oid: z.string().regex(/^[0-9a-f]{40}$/iu) }),
    z.null(),
  ]),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  reviewDecision: z.union([
    z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]),
    z.literal(""),
    z.null(),
  ]),
  statusCheckRollup: z.array(
    z.object({
      status: z.string().optional(),
      conclusion: z.string().optional(),
      state: z.string().optional(),
    }),
  ),
});

type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;

export type GitHubRunner = (args: readonly string[]) => Promise<string>;

export interface GitHubInspectorDependencies {
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  runGitHub?: GitHubRunner;
}

export type PullRequestInspector = (
  url: string,
) => Promise<PullRequestSnapshot>;

const parseIdentity = (
  pullRequestUrl: string,
): { repository: string; number: number } => {
  let parsed: URL;
  try {
    parsed = new URL(pullRequestUrl);
  } catch {
    throw usageError(
      "Pass a canonical GitHub pull-request URL such as https://github.com/owner/repository/pull/123.",
    );
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const number = Number(parts[3]);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parts.length !== 4 ||
    parts[2]?.toLowerCase() !== "pull" ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw usageError(
      "Pass a canonical GitHub pull-request URL such as https://github.com/owner/repository/pull/123.",
    );
  }
  const [owner, repository] = parts;
  if (!owner || !repository) {
    throw usageError("The GitHub pull-request URL has no repository name.");
  }
  return {
    repository: `${owner}/${repository}`.toLowerCase(),
    number,
  };
};

type CheckResult = "success" | "failure" | "pending" | "neutral" | "unknown";

const normalizeCheck = (
  check: GitHubPullRequest["statusCheckRollup"][number],
): CheckResult => {
  const state = check.state?.toUpperCase();
  if (state === "FAILURE" || state === "ERROR") return "failure";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  if (state === "SUCCESS") return "success";

  const status = check.status?.toUpperCase();
  if (status !== undefined && status !== "COMPLETED") return "pending";
  const conclusion = check.conclusion?.toUpperCase();
  if (
    conclusion === "FAILURE" ||
    conclusion === "CANCELLED" ||
    conclusion === "TIMED_OUT" ||
    conclusion === "ACTION_REQUIRED" ||
    conclusion === "STARTUP_FAILURE"
  ) {
    return "failure";
  }
  if (conclusion === "SUCCESS") return "success";
  if (conclusion === "NEUTRAL" || conclusion === "SKIPPED") return "neutral";
  return "unknown";
};

export const summarizeChecks = (
  checks: GitHubPullRequest["statusCheckRollup"],
): PullRequestSnapshot["checkSummary"] => {
  if (checks.length === 0) return "unknown";
  const results = new Set(checks.map(normalizeCheck));
  if (results.has("failure")) return "failure";
  if (results.has("pending")) return "pending";
  if (results.has("unknown")) return "unknown";
  if (results.has("success")) return "success";
  return "neutral";
};

const defaultGitHubRunner = (
  environment: NodeJS.ProcessEnv,
): GitHubRunner => async (args) => {
  const result = await execFileAsync("gh", [...args], {
    encoding: "utf8",
    env: withoutWorkGraphCredentials(environment),
    maxBuffer: 1_000_000,
    timeout: 30_000,
  });
  return result.stdout;
};

export const inspectGitHubPullRequest = async (
  url: string,
  dependencies: GitHubInspectorDependencies = {},
): Promise<PullRequestSnapshot> => {
  const requestedIdentity = parseIdentity(url);
  const environment = dependencies.environment ?? process.env;
  const runGitHub =
    dependencies.runGitHub ?? defaultGitHubRunner(environment);
  let raw: string;
  try {
    raw = await runGitHub([
      "pr",
      "view",
      url,
      "--json",
      "number,url,headRefOid,mergeCommit,state,isDraft,mergeable,reviewDecision,statusCheckRollup",
    ]);
  } catch (cause) {
    throw new CliError(
      "GITHUB_LOOKUP_FAILED",
      "Could not inspect the pull request with gh. Check that gh is installed and authenticated.",
      EXIT_CODES.transport,
      { cause },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CliError(
      "INVALID_GITHUB_RESPONSE",
      "gh returned malformed pull-request data.",
      EXIT_CODES.transport,
      { cause },
    );
  }
  const result = githubPullRequestSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      "INVALID_GITHUB_RESPONSE",
      "gh returned incomplete pull-request data.",
      EXIT_CODES.transport,
      { details: z.flattenError(result.error) },
    );
  }
  const pullRequest = result.data;
  let returnedIdentity: ReturnType<typeof parseIdentity>;
  try {
    returnedIdentity = parseIdentity(pullRequest.url);
  } catch (cause) {
    throw new CliError(
      "INVALID_GITHUB_RESPONSE",
      "gh returned an invalid pull-request URL.",
      EXIT_CODES.transport,
      { cause },
    );
  }
  if (
    returnedIdentity.repository !== requestedIdentity.repository ||
    returnedIdentity.number !== requestedIdentity.number ||
    returnedIdentity.number !== pullRequest.number
  ) {
    throw new CliError(
      "INVALID_GITHUB_RESPONSE",
      "gh returned a different pull request than the requested URL.",
      EXIT_CODES.transport,
    );
  }
  const reviewDecision =
    pullRequest.reviewDecision === "" || pullRequest.reviewDecision === null
      ? null
      : ({
          APPROVED: "approved",
          CHANGES_REQUESTED: "changes_requested",
          REVIEW_REQUIRED: "review_required",
        } as const)[pullRequest.reviewDecision];

  return {
    repository: returnedIdentity.repository,
    number: pullRequest.number,
    url: pullRequest.url,
    headSha: pullRequest.headRefOid.toLowerCase(),
    acceptedHeadSha:
      pullRequest.state === "MERGED"
        ? pullRequest.headRefOid.toLowerCase()
        : null,
    mergeCommitSha: pullRequest.mergeCommit?.oid.toLowerCase() ?? null,
    state: ({ OPEN: "open", CLOSED: "closed", MERGED: "merged" } as const)[
      pullRequest.state
    ],
    draft: pullRequest.isDraft,
    mergeability: ({
      MERGEABLE: "mergeable",
      CONFLICTING: "conflicting",
      UNKNOWN: "unknown",
    } as const)[pullRequest.mergeable],
    reviewDecision,
    checkSummary: summarizeChecks(pullRequest.statusCheckRollup),
    observedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  };
};
