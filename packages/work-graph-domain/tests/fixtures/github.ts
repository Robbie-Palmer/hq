import type { GitHubDelivery } from "../../src/github-delivery";

export const repository = "example/site";
export const headSha = "a".repeat(40);
export const mergeSha = "b".repeat(40);
export const providerTime = "2026-10-01T12:00:00.000Z";
export function githubDelivery(
  event = "pull_request",
  sequence = 1,
): GitHubDelivery {
  const payloads: Record<string, Record<string, unknown>> = {
    pull_request: {
      action: "closed",
      pull_request: {
        number: 7,
        head: { sha: headSha },
        merge_commit_sha: mergeSha,
        state: "closed",
        merged: true,
        draft: false,
        mergeable: true,
        html_url: `https://github.com/${repository}/pull/7`,
        updated_at: providerTime,
      },
    },
    workflow_run: {
      action: "completed",
      workflow_run: {
        id: 10,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
        head_sha: headSha,
        name: "CI",
        html_url: `https://github.com/${repository}/actions/runs/10`,
        updated_at: providerTime,
      },
    },
    deployment_status: {
      action: "created",
      deployment: { id: 20, sha: mergeSha, environment: "production" },
      deployment_status: {
        id: 21,
        state: "success",
        created_at: providerTime,
        url: `https://api.github.com/repos/${repository}/deployments/20/statuses/21`,
      },
    },
  };
  return {
    deliveryId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    payloadDigest: sequence.toString(16).padStart(64, "0"),
    receivedAt: "2026-10-02T00:00:00.000Z",
    repository,
    installationId: 42,
    event,
    payload: {
      ...payloads[event],
      installation: { id: 42 },
      repository: { full_name: repository },
    },
  };
}
