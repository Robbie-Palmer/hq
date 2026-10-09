import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  InvalidGitHubDelivery,
  normalizeGitHubDelivery,
  WorkGraphError,
  type DeliveryEvidenceObservation,
  type GitHubDelivery,
  type GitHubObservation,
  type PullRequestSnapshot,
} from "work-graph-domain";
import type { Db, DbTransaction } from "./connection";
import { WorkGraphRepository } from "./repository";
import {
  currentDeliveryEvidence,
  deliveryEvidenceObservation,
  githubDeliveryProcessing,
  graphMutationLock,
  pullRequest,
  workItemPullRequest,
} from "./schema";

type Disposition = typeof githubDeliveryProcessing.$inferSelect.disposition;

/** This boundary can observe delivery facts but exposes no work-item mutations. */
export class GitHubDeliveryConsumer {
  constructor(private readonly db: Db) {}

  async consume(delivery: GitHubDelivery): Promise<Disposition> {
    const repository = new WorkGraphRepository(this.db);
    const receipt = await repository.recordExternalDelivery({
      provider: "github",
      externalId: delivery.deliveryId,
      payloadDigest: delivery.payloadDigest,
      receivedAt: delivery.receivedAt,
      ingestedAt: new Date().toISOString(),
    });
    try {
      return await this.db.transaction(async (transaction) => {
        // Share the PR/link event lock so association and projection are atomic
        // with explicit links and concurrent consumers, including redeliveries.
        await transaction
          .select()
          .from(graphMutationLock)
          .where(eq(graphMutationLock.id, "event-sequence"))
          .for("update");
        const [previous] = await transaction
          .select()
          .from(githubDeliveryProcessing)
          .where(eq(githubDeliveryProcessing.deliveryId, delivery.deliveryId));
        if (
          previous?.disposition === "processed" ||
          previous?.disposition === "ignored"
        ) {
          return previous.disposition;
        }
        const raw = normalizeGitHubDelivery(delivery);
        const observation =
          raw === null
            ? null
            : {
                ...raw,
                evidence: { ...raw.evidence, ingestedAt: receipt.ingestedAt },
              };
        if (observation?.pullRequest) {
          await refreshObservedPullRequest(transaction, observation.pullRequest);
        }
        const disposition =
          observation === null
            ? "ignored"
            : await appendCorrelatedEvidence(transaction, observation);
        await transaction
          .insert(githubDeliveryProcessing)
          .values({
            deliveryId: delivery.deliveryId,
            repository: delivery.repository.toLowerCase(),
            commitSha: observation?.evidence.commitSha ?? null,
            disposition,
            observation,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: githubDeliveryProcessing.deliveryId,
            set: {
              disposition,
              observation,
              failureCode: null,
              updatedAt: new Date(),
            },
          });
        if (observation?.pullRequest) {
          await correlateWaitingDeliveries(transaction, observation);
        }
        return disposition;
      });
    } catch (error) {
      // Do not persist payloads, SQL errors, connection strings, or credentials.
      const failureCode =
        error instanceof InvalidGitHubDelivery ||
        error instanceof WorkGraphError
          ? "invalid_observation"
          : "processing_failed";
      await this.db
        .insert(githubDeliveryProcessing)
        .values({
          deliveryId: delivery.deliveryId,
          repository: delivery.repository.toLowerCase(),
          disposition: "failed",
          failureCode,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: githubDeliveryProcessing.deliveryId,
          set: { disposition: "failed", failureCode, updatedAt: new Date() },
          setWhere: inArray(githubDeliveryProcessing.disposition, [
            "failed",
            "unmatched",
          ]),
        });
      throw error;
    }
  }
}

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

async function appendCorrelatedEvidence(
  transaction: DbTransaction,
  observation: GitHubObservation,
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
  const isHeadCi = fact.kind === "ci" &&
    (match.headSha === fact.commitSha || match.acceptedHeadSha === fact.commitSha);
  const stored = await new WorkGraphRepository(
    transaction,
  ).recordEvidenceObservation(
    {
      ...fact,
      correlationKind:
        !isHeadCi && match.mergeCommitSha === fact.commitSha
          ? "pull_request_merge"
          : "pull_request_head",
      pullRequestRepository: match.repository,
      pullRequestNumber: match.number,
    },
    { projectCurrent: false },
  );
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

async function correlateWaitingDeliveries(
  transaction: DbTransaction,
  observation: GitHubObservation,
): Promise<void> {
  const snapshot = observation.pullRequest;
  if (!snapshot) return;
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
    const disposition = await appendCorrelatedEvidence( // NOSONAR: Nested savepoints share one transaction and must run serially.
      transaction,
      item.observation,
    );
    await transaction // NOSONAR: Persist each disposition after its evidence transaction completes.
      .update(githubDeliveryProcessing)
      .set({ disposition, updatedAt: new Date() })
      .where(eq(githubDeliveryProcessing.deliveryId, item.deliveryId));
  }
}

async function refreshObservedPullRequest(transaction: DbTransaction, snapshot: PullRequestSnapshot): Promise<void> {
  const [current] = await transaction.select().from(pullRequest).where(and(
    eq(pullRequest.repository, snapshot.repository), eq(pullRequest.number, snapshot.number),
  ));
  // A late open snapshot cannot undo a merge, even at equal provider times.
  if (current?.state !== "merged" || snapshot.state === "merged") {
    await new WorkGraphRepository(transaction).refreshPullRequest(snapshot);
  }
}
