import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  InvalidGitHubDelivery,
  type DeliveryEvidenceObservation,
  type GitHubObservation,
  type PullRequestSnapshot,
} from "work-graph-domain";
import type { DbTransaction } from "./connection";
import {
  currentDeliveryEvidence,
  deliveryEvidenceObservation,
  githubDeliveryProcessing,
  pullRequest,
  workItemPullRequest,
} from "./schema";
type Disposition = typeof githubDeliveryProcessing.$inferSelect.disposition;
type EvidenceRecorder = (
  observation: DeliveryEvidenceObservation,
) => Promise<DeliveryEvidenceObservation>;

function factIdentity(observation: DeliveryEvidenceObservation): string {
  return JSON.stringify([
    observation.repository,
    observation.commitSha,
    observation.kind,
    observation.state,
    observation.name,
    observation.environment,
    observation.providerObservedAt,
  ]);
}

export async function appendCorrelatedEvidence(
  transaction: DbTransaction,
  observation: GitHubObservation,
  recordEvidence: EvidenceRecorder,
): Promise<Disposition> {
  const fact = observation.evidence;
  const [existing] = await transaction
    .select()
    .from(deliveryEvidenceObservation)
    .where(
      and(
        eq(deliveryEvidenceObservation.provider, fact.provider),
        eq(deliveryEvidenceObservation.kind, fact.kind),
        eq(deliveryEvidenceObservation.externalId, fact.externalId),
        eq(
          deliveryEvidenceObservation.providerObservedAt,
          new Date(fact.providerObservedAt),
        ),
        eq(deliveryEvidenceObservation.state, fact.state),
      ),
    );
  if (existing) {
    if (
      factIdentity({
        ...existing,
        providerObservedAt: existing.providerObservedAt.toISOString(),
        ingestedAt: existing.ingestedAt.toISOString(),
      }) !== factIdentity(fact)
    ) {
      throw new InvalidGitHubDelivery();
    }
    await projectObservation(transaction, existing.id, observation);
    return "processed";
  }
  const candidates = await transaction
    .selectDistinct({
      repository: pullRequest.repository,
      number: pullRequest.number,
      headSha: pullRequest.headSha,
      acceptedHeadSha: pullRequest.acceptedHeadSha,
      mergeCommitSha: pullRequest.mergeCommitSha,
    })
    .from(pullRequest)
    .innerJoin(
      workItemPullRequest,
      and(
        eq(pullRequest.repository, workItemPullRequest.repository),
        eq(pullRequest.number, workItemPullRequest.number),
        eq(workItemPullRequest.role, "implementation"),
      ),
    )
    .where(
      and(
        eq(pullRequest.repository, fact.repository),
        observation.pullRequest
          ? eq(pullRequest.number, observation.pullRequest.number)
          : undefined,
        sql`(${pullRequest.headSha} = ${fact.commitSha} or ${pullRequest.acceptedHeadSha} = ${fact.commitSha} or ${pullRequest.mergeCommitSha} = ${fact.commitSha})`,
      ),
    );
  // A shared commit cannot choose between two different implementation PRs.
  // Keep the fact for reconciliation instead of inventing a single provenance.
  if (candidates.length !== 1) return "unmatched";
  const match = candidates[0];
  if (!match) return "unmatched";
  const isHeadCi =
    fact.kind === "ci" &&
    (match.headSha === fact.commitSha ||
      match.acceptedHeadSha === fact.commitSha);
  const stored = await recordEvidence({
    ...fact,
    correlationKind:
      !isHeadCi && match.mergeCommitSha === fact.commitSha
        ? "pull_request_merge"
        : "pull_request_head",
    pullRequestRepository: match.repository,
    pullRequestNumber: match.number,
  });
  await projectObservation(transaction, stored.id, observation);
  return "processed";
}

async function projectObservation(
  transaction: DbTransaction,
  observationId: string,
  observation: GitHubObservation,
): Promise<void> {
  const fact = observation.evidence;
  const projection = {
    provider: fact.provider,
    kind: fact.kind,
    externalId: fact.externalId,
    observationId,
    providerObservedAt: new Date(fact.providerObservedAt),
    providerSequence: observation.providerSequence,
    projectedAt: new Date(fact.ingestedAt),
  };
  await transaction
    .insert(currentDeliveryEvidence)
    .values(projection)
    .onConflictDoUpdate({
      target: [
        currentDeliveryEvidence.provider,
        currentDeliveryEvidence.kind,
        currentDeliveryEvidence.externalId,
      ],
      set: projection,
      setWhere: or(
        lt(
          currentDeliveryEvidence.providerObservedAt,
          projection.providerObservedAt,
        ),
        and(
          eq(
            currentDeliveryEvidence.providerObservedAt,
            projection.providerObservedAt,
          ),
          sql`coalesce(${currentDeliveryEvidence.providerSequence}, -1) < ${projection.providerSequence}`,
        ),
      ),
    });
}

export async function correlateWaitingDeliveries(
  transaction: DbTransaction,
  snapshot: PullRequestSnapshot,
  recordEvidence: EvidenceRecorder,
): Promise<void> {
  const commits = [
    snapshot.headSha,
    snapshot.acceptedHeadSha,
    snapshot.mergeCommitSha,
  ].filter((value): value is string => value !== null);
  const waiting = await transaction
    .select()
    .from(githubDeliveryProcessing)
    .where(
      and(
        eq(githubDeliveryProcessing.repository, snapshot.repository),
        eq(githubDeliveryProcessing.disposition, "unmatched"),
        inArray(githubDeliveryProcessing.commitSha, commits),
      ),
    );
  for (const item of waiting) {
    if (!item.observation) continue;
    const disposition = await appendCorrelatedEvidence(transaction, item.observation, recordEvidence); // NOSONAR: Nested savepoints share one transaction and must run serially.
    await transaction // NOSONAR: Persist each disposition after its evidence transaction completes.
      .update(githubDeliveryProcessing)
      .set({ disposition, updatedAt: new Date() })
      .where(eq(githubDeliveryProcessing.deliveryId, item.deliveryId));
  }
}
