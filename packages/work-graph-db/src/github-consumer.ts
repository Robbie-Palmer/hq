import { createHash } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  type GitHubDelivery,
  type GitHubDeliveryDisposition,
  type GitHubObservation,
  InvalidGitHubDelivery,
  normalizeGitHubDelivery,
  type PullRequestSnapshot,
  WorkGraphError,
} from "work-graph-domain";
import type { Db, DbTransaction } from "./connection";
import {
  appendCorrelatedEvidence,
  correlateWaitingDeliveries,
} from "./github-correlation";
import { WorkGraphRepository } from "./repository";
import {
  githubDeliveryProcessing,
  graphMutationLock,
  pullRequest,
  workItemPullRequest,
} from "./schema";

async function previousTerminalDisposition(
  transaction: DbTransaction,
  deliveryId: string,
): Promise<GitHubDeliveryDisposition | undefined> {
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
    .where(eq(githubDeliveryProcessing.deliveryId, deliveryId));
  return previous?.disposition === "processed" ||
    previous?.disposition === "ignored"
    ? previous.disposition
    : undefined;
}

async function processObservation(
  transaction: DbTransaction,
  delivery: GitHubDelivery,
  ingestedAt: string,
): Promise<{
  disposition: GitHubDeliveryDisposition;
  observation: GitHubObservation | null;
}> {
  const scopedRepository = new WorkGraphRepository(transaction);
  const recordEvidence = (
    input: Parameters<WorkGraphRepository["recordEvidenceObservation"]>[0],
  ) => scopedRepository.recordEvidenceObservation(input, { projectCurrent: false });
  const recordDeliveryAction = async (observationId: string) => {
    await scopedRepository.recordDeliveryActionObservation(observationId);
  };
  const raw = normalizeGitHubDelivery(delivery);
  const observation =
    raw === null
      ? null
      : { ...raw, evidence: { ...raw.evidence, ingestedAt } };
  if (observation?.pullRequest) {
    if (observation.deliveryMetadata !== undefined) {
      await scopedRepository.putDeliveryMetadataRevision(
        observation.deliveryMetadata,
        observation.deliveryMetadataCreatedAt ?? ingestedAt,
      );
    }
    await refreshObservedPullRequest(transaction, observation.pullRequest);
  }
  const disposition =
    observation === null
      ? "ignored"
      : await appendCorrelatedEvidence(
          transaction,
          observation,
          recordEvidence,
          recordDeliveryAction,
        );
  if (observation?.pullRequest) {
    await correlateWaitingDeliveries(
      transaction,
      observation.pullRequest,
      recordEvidence,
      recordDeliveryAction,
    );
  }
  return { disposition, observation };
}

async function storeProcessingDisposition(
  transaction: DbTransaction,
  delivery: GitHubDelivery,
  disposition: GitHubDeliveryDisposition,
  observation: GitHubObservation | null,
): Promise<void> {
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
}

function evaluationId(deliveryId: string, workItemId: string): string {
  const bytes = createHash("sha256")
    .update("github-completion-candidate\0")
    .update(deliveryId)
    .update("\0")
    .update(workItemId)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Converts a GitHub transport delivery into correlated evidence. On successful
 * processing, the database transaction stores the observation and disposition
 * atomically. Completion-policy evaluation starts only after it commits.
 *
 * The caller supplies evidence. A stored completion policy is the only route
 * from the resulting facts to a work-item state change.
 */
export class GitHubDeliveryConsumer {
  constructor(private readonly db: Db) {}

  async consume(delivery: GitHubDelivery): Promise<GitHubDeliveryDisposition> {
    const repository = new WorkGraphRepository(this.db);
    const receipt = await repository.recordExternalDelivery({
      provider: "github",
      externalId: delivery.deliveryId,
      payloadDigest: delivery.payloadDigest,
      receivedAt: delivery.receivedAt,
      ingestedAt: new Date().toISOString(),
    });
    try {
      const disposition = await this.db.transaction(async (transaction) => {
        const previous = await previousTerminalDisposition(
          transaction,
          delivery.deliveryId,
        );
        if (previous !== undefined) return previous;
        const { disposition, observation } = await processObservation(
          transaction,
          delivery,
          receipt.ingestedAt,
        );
        await storeProcessingDisposition(
          transaction,
          delivery,
          disposition,
          observation,
        );
        return disposition;
      });
      const [processing] = await this.db
        .select({ commitSha: githubDeliveryProcessing.commitSha })
        .from(githubDeliveryProcessing)
        .where(eq(githubDeliveryProcessing.deliveryId, delivery.deliveryId))
        .limit(1);
      if (processing?.commitSha) {
        const targets = await this.db
          .selectDistinct({ workItemId: workItemPullRequest.workItemId })
          .from(workItemPullRequest)
          .innerJoin(
            pullRequest,
            and(
              eq(pullRequest.repository, workItemPullRequest.repository),
              eq(pullRequest.number, workItemPullRequest.number),
            ),
          )
          .where(
            and(
              eq(workItemPullRequest.role, "implementation"),
              eq(pullRequest.repository, delivery.repository.toLowerCase()),
              or(
                eq(pullRequest.headSha, processing.commitSha),
                eq(pullRequest.acceptedHeadSha, processing.commitSha),
                eq(pullRequest.mergeCommitSha, processing.commitSha),
              ),
            ),
          );
        const evaluatedAt = receipt.ingestedAt;
        await Promise.all(
          targets.map((target) =>
            repository.evaluateCompletionCandidateAndReleaseIfConfigured({
              id: evaluationId(delivery.deliveryId, target.workItemId),
              workItemId: target.workItemId,
              evaluatedAt,
            }),
          ),
        );
      }
      return disposition;
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

async function refreshObservedPullRequest(
  transaction: DbTransaction,
  snapshot: PullRequestSnapshot,
): Promise<void> {
  const [current] = await transaction
    .select()
    .from(pullRequest)
    .where(
      and(
        eq(pullRequest.repository, snapshot.repository),
        eq(pullRequest.number, snapshot.number),
      ),
    );
  // A late open snapshot cannot undo a merge, even at equal provider times.
  if (current?.state !== "merged" || snapshot.state === "merged") {
    await new WorkGraphRepository(transaction).refreshPullRequest(snapshot);
  }
}
