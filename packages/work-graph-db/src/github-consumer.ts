import { and, eq, inArray } from "drizzle-orm";
import {
  InvalidGitHubDelivery,
  normalizeGitHubDelivery,
  WorkGraphError,
  type GitHubDelivery,
  type PullRequestSnapshot,
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
        const scopedRepository = new WorkGraphRepository(transaction);
        const recordEvidence = (
          input: Parameters<
            WorkGraphRepository["recordEvidenceObservation"]
          >[0],
        ) =>
          scopedRepository.recordEvidenceObservation(input, {
            projectCurrent: false,
          });
        const raw = normalizeGitHubDelivery(delivery);
        const observation =
          raw === null
            ? null
            : {
                ...raw,
                evidence: { ...raw.evidence, ingestedAt: receipt.ingestedAt },
              };
        if (observation?.pullRequest) {
          await refreshObservedPullRequest(
            transaction,
            observation.pullRequest,
          );
        }
        const disposition =
          observation === null
            ? "ignored"
            : await appendCorrelatedEvidence(
                transaction,
                observation,
                recordEvidence,
              );
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
          await correlateWaitingDeliveries(
            transaction,
            observation.pullRequest,
            recordEvidence,
          );
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
