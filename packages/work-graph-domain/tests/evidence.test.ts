import {
  evaluateCompletionCandidate,
  normalizeEvidenceObservation,
  projectCurrentDeliveryEvidence,
  type WorkGraphError,
  type CompletionPolicyRevision,
  type CurrentDeliveryEvidence,
  type DeliveryEvidenceObservation,
  type PullRequestSnapshot,
} from "../src/index";

const sha = (character: string): string => character.repeat(40);
const uuid = (suffix: number): string =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

const observation = (
  suffix: number,
  overrides: Partial<DeliveryEvidenceObservation> = {},
): DeliveryEvidenceObservation => ({
  id: uuid(suffix),
  deliveryProvider: "github",
  deliveryExternalId: `delivery-${suffix}`,
  provider: "github",
  externalId: `run-${suffix}`,
  repository: "example/repository",
  commitSha: sha("a"),
  kind: "ci",
  state: "success",
  name: "verify",
  environment: null,
  sourceUrl: `https://github.com/example/repository/actions/runs/${suffix}`,
  providerObservedAt: `2026-09-22T10:${suffix.toString().padStart(2, "0")}:00.000Z`,
  ingestedAt: `2026-09-22T11:${suffix.toString().padStart(2, "0")}:00.000Z`,
  correlationKind: "pull_request_head",
  pullRequestRepository: "example/repository",
  pullRequestNumber: 1,
  ...overrides,
});

const pullRequest = (
  number: number,
  acceptedHeadSha: string,
  mergeCommitSha: string,
): PullRequestSnapshot => ({
  repository: "example/repository",
  number,
  url: `https://github.com/example/repository/pull/${number}`,
  headSha: acceptedHeadSha,
  acceptedHeadSha,
  mergeCommitSha,
  state: "merged",
  draft: false,
  mergeability: "unknown",
  reviewDecision: "approved",
  checkSummary: "success",
  observedAt: "2026-09-22T10:00:00.000Z",
});

const policy: CompletionPolicyRevision = {
  policyId: "default",
  revision: 3,
  requiredCiNames: ["verify"],
  productionEnvironments: ["production"],
  createdAt: "2026-09-22T09:00:00.000Z",
};

const evidenceFor = (
  pr: PullRequestSnapshot,
  offset: number,
): readonly CurrentDeliveryEvidence[] => [
  {
    ...observation(offset, {
      externalId: `pr-${pr.number}`,
      kind: "pull_request",
      name: null,
      commitSha: pr.mergeCommitSha ?? sha("f"),
      correlationKind: "pull_request_merge",
      pullRequestNumber: pr.number,
    }),
    projectedAt: "2026-09-22T12:00:00.000Z",
  },
  {
    ...observation(offset + 1, {
      externalId: `ci-${pr.number}`,
      commitSha: pr.acceptedHeadSha ?? sha("f"),
      pullRequestNumber: pr.number,
    }),
    projectedAt: "2026-09-22T12:00:00.000Z",
  },
  {
    ...observation(offset + 2, {
      externalId: `deployment-${pr.number}`,
      kind: "deployment",
      name: null,
      environment: "production",
      commitSha: pr.mergeCommitSha ?? sha("f"),
      correlationKind: "pull_request_merge",
      pullRequestNumber: pr.number,
    }),
    projectedAt: "2026-09-22T12:00:00.000Z",
  },
];

describe("delivery evidence", () => {
  it("keeps immutable history while projecting the latest provider observation", () => {
    const latest = observation(2, {
      externalId: "workflow-1",
      providerObservedAt: "2026-09-22T12:00:00.000Z",
      state: "success",
    });
    const staleFailure = observation(3, {
      externalId: "workflow-1",
      providerObservedAt: "2026-09-22T11:00:00.000Z",
      ingestedAt: "2026-09-22T13:00:00.000Z",
      state: "failure",
    });

    expect(projectCurrentDeliveryEvidence([latest, staleFailure])).toEqual([
      expect.objectContaining({ id: latest.id, state: "success" }),
    ]);
    expect([latest, staleFailure]).toHaveLength(2);
  });

  it("rejects correlation claims without an exact pull-request identity", () => {
    expect(() =>
      normalizeEvidenceObservation(
        observation(4, {
          pullRequestRepository: null,
          pullRequestNumber: null,
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_evidence_observation",
      }),
    );
  });
});

describe("completion candidacy", () => {
  it("requires evidence for every implementation pull request", () => {
    const first = pullRequest(1, sha("a"), sha("b"));
    const second = pullRequest(2, sha("c"), sha("d"));
    const stagingSource = evidenceFor(second, 25).find(
      (item) => item.kind === "deployment",
    );
    if (!stagingSource) throw new Error("Expected deployment evidence.");
    const staging = {
      ...stagingSource,
      id: uuid(25),
      externalId: "staging-deployment",
      environment: "staging",
      providerObservedAt: "2026-09-22T13:00:00.000Z",
    } as CurrentDeliveryEvidence;
    const result = evaluateCompletionCandidate({
      workItemId: "delivery",
      policy,
      implementationPullRequests: [first, second],
      evidence: [
        ...evidenceFor(first, 10),
        staging,
        ...evidenceFor(second, 20),
      ],
      hasUnfinishedChildren: false,
      hasUnresolvedBlockingAttention: false,
      evaluatedAt: "2026-09-22T14:00:00.000Z",
    });

    expect(result).toEqual({
      workItemId: "delivery",
      policyId: "default",
      policyRevision: 3,
      candidate: true,
      reasons: [],
      evidenceObservationIds: [
        uuid(10),
        uuid(11),
        uuid(12),
        uuid(20),
        uuid(21),
        uuid(22),
      ],
      evaluatedAt: "2026-09-22T14:00:00.000Z",
    });
  });

  it("does not treat staging, failed, or cancelled observations as completion", () => {
    const pr = pullRequest(1, sha("a"), sha("b"));
    const evidence = evidenceFor(pr, 30).map((item) => {
      if (item.kind === "ci") {
        return {
          ...item,
          state: "cancelled" as const,
          providerObservedAt: "2026-09-22T15:00:00.000Z",
        };
      }
      if (item.kind === "deployment") {
        return {
          ...item,
          state: "failure" as const,
          environment: "staging",
        };
      }
      return item;
    });
    const earlierSuccessfulCi = evidenceFor(pr, 50).find(
      (item) => item.kind === "ci",
    );
    if (!earlierSuccessfulCi) throw new Error("Expected CI evidence.");
    const result = evaluateCompletionCandidate({
      workItemId: "delivery",
      policy,
      implementationPullRequests: [pr],
      evidence: [...evidence, earlierSuccessfulCi],
      hasUnfinishedChildren: false,
      hasUnresolvedBlockingAttention: false,
      evaluatedAt: "2026-09-22T14:00:00.000Z",
    });

    expect(result.candidate).toBe(false);
    expect(result.reasons).toEqual([
      "missing_required_ci",
      "missing_production_deployment",
    ]);
  });

  it("keeps unfinished children and unresolved attention explicit", () => {
    const pr = pullRequest(1, sha("a"), sha("b"));
    const result = evaluateCompletionCandidate({
      workItemId: "delivery",
      policy,
      implementationPullRequests: [pr],
      evidence: evidenceFor(pr, 40),
      hasUnfinishedChildren: true,
      hasUnresolvedBlockingAttention: true,
      evaluatedAt: "2026-09-22T14:00:00.000Z",
    });

    expect(result.candidate).toBe(false);
    expect(result.reasons).toEqual([
      "unfinished_children",
      "unresolved_blocking_attention",
    ]);
  });
});
