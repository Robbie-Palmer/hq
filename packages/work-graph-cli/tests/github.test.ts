import { describe, expect, it, vi } from "vitest";
import { CliError } from "../src/errors.js";
import {
  inspectGitHubPullRequest,
  summarizeChecks,
} from "../src/github.js";

const githubResult = {
  number: 42,
  url: "https://github.com/Example/Work-Graph/pull/42",
  headRefOid: "0123456789ABCDEF0123456789ABCDEF01234567",
  state: "OPEN",
  isDraft: true,
  mergeable: "CONFLICTING",
  reviewDecision: "CHANGES_REQUESTED",
  statusCheckRollup: [
    { status: "COMPLETED", conclusion: "SUCCESS" },
    { state: "SUCCESS" },
  ],
};

describe("GitHub pull-request inspection", () => {
  it("maps gh output into a Work Graph snapshot", async () => {
    const runGitHub = vi.fn(async () => JSON.stringify(githubResult));

    await expect(
      inspectGitHubPullRequest(githubResult.url, {
        now: () => new Date("2026-09-20T15:00:00.000Z"),
        runGitHub,
      }),
    ).resolves.toEqual({
      repository: "example/work-graph",
      number: 42,
      url: githubResult.url,
      headSha: "0123456789abcdef0123456789abcdef01234567",
      state: "open",
      draft: true,
      mergeability: "conflicting",
      reviewDecision: "changes_requested",
      checkSummary: "success",
      observedAt: "2026-09-20T15:00:00.000Z",
    });
    expect(runGitHub).toHaveBeenCalledWith([
      "pr",
      "view",
      githubResult.url,
      "--json",
      "number,url,headRefOid,state,isDraft,mergeable,reviewDecision,statusCheckRollup",
    ]);
  });

  it("maps merged PRs without a review decision or checks", async () => {
    const runGitHub = vi.fn(async () =>
      JSON.stringify({
        ...githubResult,
        state: "MERGED",
        isDraft: false,
        mergeable: "UNKNOWN",
        reviewDecision: "",
        statusCheckRollup: [],
      }),
    );

    await expect(
      inspectGitHubPullRequest(githubResult.url, { runGitHub }),
    ).resolves.toMatchObject({
      state: "merged",
      draft: false,
      mergeability: "unknown",
      reviewDecision: null,
      checkSummary: "unknown",
    });
  });

  it.each([
    [[], "unknown"],
    [[{ status: "IN_PROGRESS" }], "pending"],
    [[{ state: "FAILURE" }, { status: "IN_PROGRESS" }], "failure"],
    [[{ status: "COMPLETED", conclusion: "NEUTRAL" }], "neutral"],
    [
      [
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
      ],
      "success",
    ],
    [[{ status: "COMPLETED", conclusion: "" }], "unknown"],
  ] as const)("summarizes check rollups %#", (checks, expected) => {
    expect(summarizeChecks([...checks])).toBe(expected);
  });

  it("rejects a non-canonical GitHub PR URL returned by gh", async () => {
    const runGitHub = vi.fn(async () =>
      JSON.stringify({
        ...githubResult,
        url: "https://example.test/Example/Work-Graph/pull/42",
      }),
    );

    await expect(
      inspectGitHubPullRequest(githubResult.url, { runGitHub }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CliError>>({
        code: "INVALID_GITHUB_RESPONSE",
        message: "gh returned an invalid pull-request URL.",
      }),
    );
  });

  it("reports gh failures without leaking process output", async () => {
    const runGitHub = vi.fn(async () => {
      throw new Error("secret stderr");
    });

    await expect(
      inspectGitHubPullRequest(githubResult.url, { runGitHub }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CliError>>({
        code: "GITHUB_LOOKUP_FAILED",
        message:
          "Could not inspect the pull request with gh. Check that gh is installed and authenticated.",
      }),
    );
  });

  it.each([
    ["not JSON", "gh returned malformed pull-request data."],
    [JSON.stringify({ url: githubResult.url }), "gh returned incomplete pull-request data."],
    [
      JSON.stringify({ ...githubResult, number: 43 }),
      "gh returned a different pull request than the requested URL.",
    ],
  ])("rejects invalid gh output %#", async (output, message) => {
    await expect(
      inspectGitHubPullRequest(githubResult.url, {
        runGitHub: vi.fn(async () => output),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CliError>>({
        code: "INVALID_GITHUB_RESPONSE",
        message,
      }),
    );
  });
});
