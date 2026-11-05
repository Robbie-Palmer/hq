import { describe, expect, it } from "vitest";
import { normalizeGitHubDelivery } from "../src/github-delivery";
import {
  githubDelivery,
  headSha,
  mergeSha,
  providerTime,
} from "./fixtures/github";

const generatedDeliveryMetadata = () => ({
  repository: "EXAMPLE/SITE",
  sourceRevision: "catalog-sha",
  targets: [
    {
      id: "delivery-target:site/api",
      projectId: "project:site",
      repository: "example/site",
      sourcePaths: [
        {
          path: "workers/site",
          mode: "exclusive",
          subjects: ["component:site/api"],
        },
      ],
      subjects: ["workload:site/api"],
      sharedHostId: null,
      requiredCiNames: ["Site CI"],
      productionEnvironments: ["production"],
    },
  ],
});

describe("GitHub observation normalization", () => {
  it("preserves the accepted head and merged commit separately", () => {
    const result = normalizeGitHubDelivery(githubDelivery());
    expect(result?.pullRequest).toMatchObject({
      acceptedHeadSha: headSha,
      mergeCommitSha: mergeSha,
      state: "merged",
    });
    expect(result?.evidence).toMatchObject({
      commitSha: mergeSha,
      state: "success",
      correlationKind: "unmatched",
    });
  });
  it.each(["open", "closed"])(
    "does not trust the speculative merge SHA on an unmerged %s PR",
    (state) => {
      const delivery = githubDelivery();
      Object.assign(delivery.payload.pull_request as object, {
        merged: false,
        state,
        mergeable: false,
      });
      const result = normalizeGitHubDelivery(delivery);
      expect(result?.pullRequest).toMatchObject({
        mergeCommitSha: null,
        acceptedHeadSha: null,
        mergeability: "conflicting",
      });
      expect(result?.evidence.state).toBe(
        state === "open" ? "pending" : "cancelled",
      );
    },
  );
  it("represents unknown mergeability without inventing reviews or checks", () => {
    const delivery = githubDelivery();
    Object.assign(delivery.payload.pull_request as object, { mergeable: null });
    expect(normalizeGitHubDelivery(delivery)?.pullRequest).toMatchObject({
      mergeability: "unknown",
      reviewDecision: null,
      checkSummary: "unknown",
    });
  });
  it("carries changed paths and generated delivery metadata into the observation", () => {
    const delivery = githubDelivery();
    Object.assign(delivery.payload.pull_request as object, {
      changed_paths: ["workers/site/src/z.ts", "workers/site/src/a.ts"],
      delivery_metadata_source_revision: "catalog-sha",
    });
    delivery.payload.work_graph_delivery_metadata = generatedDeliveryMetadata();
    delivery.payload.work_graph_delivery_metadata_created_at = providerTime;

    expect(normalizeGitHubDelivery(delivery)).toMatchObject({
      pullRequest: {
        changedPaths: ["workers/site/src/a.ts", "workers/site/src/z.ts"],
        deliveryMetadataSourceRevision: "catalog-sha",
      },
      deliveryMetadata: {
        repository: "example/site",
        sourceRevision: "catalog-sha",
        targets: [{ id: "delivery-target:site/api" }],
      },
      deliveryMetadataCreatedAt: providerTime,
    });
  });
  it("rejects generated delivery metadata without a valid creation time", () => {
    const delivery = githubDelivery();
    delivery.payload.work_graph_delivery_metadata = generatedDeliveryMetadata();
    delivery.payload.work_graph_delivery_metadata_created_at = "yesterday";

    expect(() => normalizeGitHubDelivery(delivery)).toThrow(
      "Malformed GitHub observation",
    );
  });
  it.each([
    "success",
    "failure",
    "cancelled",
    "skipped",
    "neutral",
    "timed_out",
    "action_required",
    "stale",
    "startup_failure",
  ])("normalizes completed CI conclusion %s conservatively", (conclusion) => {
    const delivery = githubDelivery("workflow_run");
    Object.assign(delivery.payload.workflow_run as object, { conclusion });
    const result = normalizeGitHubDelivery(delivery);
    expect(result?.evidence.state).toBe(
      conclusion === "success"
        ? "success"
        : conclusion === "cancelled"
          ? "cancelled"
          : "failure",
    );
    expect(result?.evidence.externalId).toBe("example/site/actions/runs/10");
  });
  it.each([
    "success",
    "error",
    "failure",
    "inactive",
    "in_progress",
    "queued",
    "pending",
    "waiting",
  ])("normalizes deployment state %s", (state) => {
    const delivery = githubDelivery("deployment_status");
    Object.assign(delivery.payload.deployment_status as object, {
      state,
      environment: "Production",
    });
    const result = normalizeGitHubDelivery(delivery);
    expect(result?.evidence.environment).toBe("production");
    expect(result?.evidence.state).toBe(
      state === "success"
        ? "success"
        : state === "inactive"
          ? "cancelled"
          : ["error", "failure"].includes(state)
            ? "failure"
            : "pending",
    );
  });
  it("ignores incomplete runs and unsupported events", () => {
    const delivery = githubDelivery("workflow_run");
    delivery.payload.action = "requested";
    expect(normalizeGitHubDelivery(delivery)).toBeNull();
    expect(normalizeGitHubDelivery(githubDelivery("ping"))).toBeNull();
  });
  it.each([
    ["pull_request", "head", null],
    ["pull_request", "head", { sha: "branch-name" }],
    ["pull_request", "number", -1],
    ["pull_request", "merged", "true"],
    ["pull_request", "state", "open"],
    ["pull_request", "html_url", ""],
    ["pull_request", "updated_at", "yesterday"],
    ["pull_request", "head", []],
    ["workflow_run", "status", "in_progress"],
    ["workflow_run", "conclusion", "unknown"],
    ["deployment_status", "state", "unknown"],
  ])("rejects malformed %s field %s", (event, key, value) => {
    const delivery = githubDelivery(event as string);
    (delivery.payload[event as string] as Record<string, unknown>)[
      key as string
    ] = value;
    expect(() => normalizeGitHubDelivery(delivery)).toThrow();
  });
  it("rejects an envelope whose repository or installation differs from the signed body", () => {
    expect(() =>
      normalizeGitHubDelivery({
        ...githubDelivery(),
        repository: "other/site",
      }),
    ).toThrow();
    expect(() =>
      normalizeGitHubDelivery({ ...githubDelivery(), installationId: 99 }),
    ).toThrow();
  });
});
