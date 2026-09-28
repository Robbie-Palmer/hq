import {
  markdownText,
  type MergedFinding,
} from "ai-review-domain/reviewer";
import type { GithubClient } from "github-client";
import { githubApiClientFromToken } from "./github-app";

export const FINDING_MARKER_PREFIX = "ai-review-finding:";
const FINDING_MARKER_PATTERN =
  /<!--\s*ai-review-finding:(f_[a-f0-9]{24})\s*-->/i;

export interface PublishableFinding extends MergedFinding {
  findingId: string;
  hunkIds: string[];
}

export interface FindingPublication {
  findingId: string;
  delivery: "line" | "fallback";
  commentId?: number;
  reconciled: boolean;
  path: string;
  line: number | null;
}

interface ExistingReviewComment {
  id?: unknown;
  body?: unknown;
  in_reply_to_id?: unknown;
  user?: { login?: unknown };
}

interface ReviewCommentResponse {
  id?: unknown;
}

function findingMarker(findingId: string): string {
  return `<!-- ${FINDING_MARKER_PREFIX}${findingId} -->`;
}

export function findingIdFromComment(body: unknown): string | undefined {
  if (typeof body !== "string") return undefined;
  const match = FINDING_MARKER_PATTERN.exec(body);
  return match?.[1]?.toLowerCase();
}

function renderFindingComment(finding: PublishableFinding): string {
  const status = finding.status === "resolved" ? "RESOLVED" : finding.severity.toUpperCase();
  const lines = [
    findingMarker(finding.findingId),
    `### ${status}: ${markdownText(finding.title, 300)}`,
    "",
    markdownText(finding.evidence),
    "",
    `Suggested fix: ${markdownText(finding.recommendation)}`,
    "",
    `Reported by: ${finding.source_models
      .map((model) => `\`${markdownText(model, 200)}\``)
      .join(", ")} · confidence: ${Math.round(finding.confidence * 100)}%`,
  ];
  if (finding.status === "resolved" && finding.resolution_note) {
    lines.push("", `Resolution: ${markdownText(finding.resolution_note, 500)}`);
  }
  lines.push(
    "",
    `<sub>Reply with \`/ai-review acknowledge <reason>\`, ` +
      `\`/ai-review confirm-fixed <reason>\`, or ` +
      `\`/ai-review reject <reason>\` before resolving this thread. ` +
      `Finding \`${finding.findingId}\`.</sub>`,
  );
  return lines.join("\n");
}

function lineIsAddressable(
  finding: PublishableFinding,
  hunks: Array<{
    hunkId: string;
    file: string;
    newStart: number;
    newLines: number;
  }>,
): boolean {
  if (!finding.line || finding.line < 1) return false;
  const findingHunks = new Set(finding.hunkIds);
  return hunks.some(
    (hunk) =>
      findingHunks.has(hunk.hunkId) &&
      hunk.file === finding.file &&
      hunk.newLines > 0 &&
      finding.line !== null &&
      finding.line >= hunk.newStart &&
      finding.line < hunk.newStart + hunk.newLines,
  );
}

async function existingFindingComments(options: {
  client: GithubClient;
  repository: string;
  pullRequestNumber: number;
  botLogin: string;
}): Promise<Map<string, number>> {
  const byFinding = new Map<string, number>();
  const collected = await options.client.paginate<ExistingReviewComment>(
    `/repos/${options.repository}/pulls/${options.pullRequestNumber}/comments`,
    { maxPages: 10 },
  );
  if (!collected.complete) {
    throw new Error(
      "Review comment reconciliation exceeded the 1,000-comment safety limit",
    );
  }
  for (const comment of collected.items) {
    if (
      comment.user?.login !== options.botLogin ||
      typeof comment.in_reply_to_id === "number"
    ) {
      continue;
    }
    const findingId = findingIdFromComment(comment.body);
    const commentId = Number(comment.id);
    if (findingId && Number.isSafeInteger(commentId) && !byFinding.has(findingId)) {
      byFinding.set(findingId, commentId);
    }
  }
  return byFinding;
}

function isUnprocessableReviewComment(error: unknown): boolean {
  if (!(error instanceof Error) || !/failed \(422\)/.test(error.message)) {
    return false;
  }
  return /line (?:is not|must be) part of the diff/i.test(error.message);
}

function publication(
  finding: PublishableFinding,
  delivery: FindingPublication["delivery"],
  reconciled: boolean,
  commentId?: number,
): FindingPublication {
  return {
    findingId: finding.findingId,
    delivery,
    ...(commentId === undefined ? {} : { commentId }),
    reconciled,
    path: finding.file,
    line: finding.line,
  };
}

async function reconcileFindingComment(options: {
  client: GithubClient;
  repository: string;
  finding: PublishableFinding;
  commentId: number;
}): Promise<FindingPublication> {
  await options.client.request(
    "PATCH",
    `/repos/${options.repository}/pulls/comments/${options.commentId}`,
    { body: { body: renderFindingComment(options.finding) } },
  );
  // GitHub can make an existing native comment's current line null on later
  // heads. It remains a line-delivered finding because the thread still exists.
  return publication(options.finding, "line", true, options.commentId);
}

async function publishLineFinding(options: {
  client: GithubClient;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  finding: PublishableFinding;
}): Promise<FindingPublication> {
  try {
    const response = await options.client.request<ReviewCommentResponse>(
      "POST",
      `/repos/${options.repository}/pulls/${options.pullRequestNumber}/comments`,
      {
        body: {
          body: renderFindingComment(options.finding),
          commit_id: options.headSha,
          path: options.finding.file,
          line: options.finding.line,
          side: "RIGHT",
        },
      },
    );
    const commentId = Number(response.id);
    if (!Number.isSafeInteger(commentId)) {
      throw new TypeError("GitHub returned an invalid review comment ID");
    }
    return publication(options.finding, "line", false, commentId);
  } catch (error) {
    if (!isUnprocessableReviewComment(error)) throw error;
    return publication(options.finding, "fallback", false);
  }
}

export async function publishFindingComments(options: {
  token: string;
  repository: string;
  pullRequestNumber: number;
  botLogin: string;
  headSha: string;
  findings: PublishableFinding[];
  hunks: Array<{
    hunkId: string;
    file: string;
    newStart: number;
    newLines: number;
  }>;
}): Promise<FindingPublication[]> {
  const client = githubApiClientFromToken(options.token);
  const existing = await existingFindingComments({ ...options, client });
  const publications: FindingPublication[] = [];
  const processed = new Set<string>();

  for (const finding of options.findings) {
    if (processed.has(finding.findingId)) continue;
    processed.add(finding.findingId);
    const existingCommentId = existing.get(finding.findingId);
    if (existingCommentId !== undefined) {
      publications.push(
        await reconcileFindingComment({
          client,
          repository: options.repository,
          finding,
          commentId: existingCommentId,
        }),
      );
      continue;
    }

    if (finding.status === "resolved") continue;
    if (!lineIsAddressable(finding, options.hunks)) {
      publications.push(publication(finding, "fallback", false));
      continue;
    }
    publications.push(await publishLineFinding({ ...options, client, finding }));
  }
  return publications;
}

export function renderFallbackFindings(
  findings: PublishableFinding[],
  publications: FindingPublication[],
): string {
  const fallbackIds = new Set(
    publications
      .filter(({ delivery }) => delivery === "fallback")
      .map(({ findingId }) => findingId),
  );
  const fallback = findings.filter(({ findingId }) => fallbackIds.has(findingId));
  if (fallback.length === 0) return "";
  const lines = [
    "## Findings without a diff line",
    "",
    "GitHub could not attach these findings to the current diff. " +
      "Use the commands shown to record an explicit disposition.",
    "",
  ];
  for (const finding of fallback) {
    const lineSuffix = finding.line ? `:${finding.line}` : "";
    const location = `${markdownText(finding.file, 500)}${lineSuffix}`;
    lines.push(
      `- **${finding.severity.toUpperCase()}: ` +
        `${markdownText(finding.title, 300)}** (\`${location}\`, ` +
        `\`${finding.findingId}\`) — ${markdownText(finding.evidence, 700)}`,
      `  - \`/ai-review acknowledge ${finding.findingId} <reason>\``,
      `  - \`/ai-review confirm-fixed ${finding.findingId} <reason>\``,
      `  - \`/ai-review reject ${finding.findingId} <reason>\``,
    );
  }
  return lines.join("\n");
}
