import { desc, eq } from "drizzle-orm";
import type {
  GovUkSourceSpec,
  RuleUpdateProposal,
} from "finance-tax-rules/gov-uk-monitor";
import type { Db } from "./db";
import type { StoredSourceArtifacts } from "./artifacts";
import {
  taxGuidanceRevision,
  taxGuidanceSource,
  taxRuleUpdateReview,
} from "./schema";

export type SourceScheduleState = {
  lastSuccessfulCheckAt: string | null;
};

export type RevisionPointer = {
  id: string;
  normalizedFingerprint: string;
  normalizedObjectKey: string;
};

export type PersistedCheck = {
  revisionId: string;
  reviewId: string | null;
  repeated: boolean;
};

export class StaleRevisionBaseError extends Error {
  constructor() {
    super("The source revision changed while the monitor prepared its diff");
    this.name = "StaleRevisionBaseError";
  }
}

export async function syncSourceAndReadState(
  db: Db,
  source: GovUkSourceSpec,
): Promise<SourceScheduleState> {
  const now = new Date();
  await db
    .insert(taxGuidanceSource)
    .values({
      id: source.id,
      title: source.title,
      pageUrl: source.pageUrl,
      contentApiUrl: source.contentApiUrl,
      ruleIds: source.ruleIds,
      effectivePeriods: source.effectivePeriods,
      checkIntervalHours: source.defaultCheckIntervalHours,
    })
    .onConflictDoUpdate({
      target: taxGuidanceSource.id,
      set: {
        title: source.title,
        pageUrl: source.pageUrl,
        contentApiUrl: source.contentApiUrl,
        ruleIds: source.ruleIds,
        effectivePeriods: source.effectivePeriods,
        checkIntervalHours: source.defaultCheckIntervalHours,
        updatedAt: now,
      },
    });
  const [row] = await db
    .select({ lastSuccessfulCheckAt: taxGuidanceSource.lastSuccessfulCheckAt })
    .from(taxGuidanceSource)
    .where(eq(taxGuidanceSource.id, source.id));
  return {
    lastSuccessfulCheckAt: row?.lastSuccessfulCheckAt?.toISOString() ?? null,
  };
}

export async function latestRevision(
  db: Db,
  sourceId: string,
): Promise<RevisionPointer | null> {
  const [row] = await db
    .select({
      id: taxGuidanceRevision.id,
      normalizedFingerprint: taxGuidanceRevision.normalizedFingerprint,
      normalizedObjectKey: taxGuidanceRevision.normalizedObjectKey,
    })
    .from(taxGuidanceRevision)
    .where(eq(taxGuidanceRevision.sourceId, sourceId))
    .orderBy(desc(taxGuidanceRevision.detectedAt), desc(taxGuidanceRevision.id))
    .limit(1);
  return row ?? null;
}

function revisionId(artifacts: StoredSourceArtifacts): string {
  return `${artifacts.sourceId}:${artifacts.rawChecksum}`;
}

export async function persistSuccessfulCheck(
  db: Db,
  input: {
    source: GovUkSourceSpec;
    artifacts: StoredSourceArtifacts;
    expectedBaseRevisionId: string | null;
    proposal: RuleUpdateProposal | null;
  },
): Promise<PersistedCheck> {
  const candidateRevisionId = revisionId(input.artifacts);
  return db.transaction(async (tx) => {
    await tx
      .select({ id: taxGuidanceSource.id })
      .from(taxGuidanceSource)
      .where(eq(taxGuidanceSource.id, input.source.id))
      .for("update");

    const [existing] = await tx
      .select({ id: taxGuidanceRevision.id })
      .from(taxGuidanceRevision)
      .where(eq(taxGuidanceRevision.id, candidateRevisionId));
    if (existing) {
      const [review] = await tx
        .select({ id: taxRuleUpdateReview.id })
        .from(taxRuleUpdateReview)
        .where(eq(taxRuleUpdateReview.candidateRevisionId, existing.id));
      await tx
        .update(taxGuidanceSource)
        .set({
          lastSuccessfulCheckAt: new Date(input.artifacts.retrievedAt),
          updatedAt: new Date(),
        })
        .where(eq(taxGuidanceSource.id, input.source.id));
      return {
        revisionId: existing.id,
        reviewId: review?.id ?? null,
        repeated: true,
      };
    }

    const [currentBase] = await tx
      .select({ id: taxGuidanceRevision.id })
      .from(taxGuidanceRevision)
      .where(eq(taxGuidanceRevision.sourceId, input.source.id))
      .orderBy(desc(taxGuidanceRevision.detectedAt), desc(taxGuidanceRevision.id))
      .limit(1);
    if ((currentBase?.id ?? null) !== input.expectedBaseRevisionId) {
      throw new StaleRevisionBaseError();
    }

    await tx.insert(taxGuidanceRevision).values({
      id: candidateRevisionId,
      sourceId: input.source.id,
      rawChecksum: input.artifacts.rawChecksum,
      normalizedFingerprint: input.artifacts.normalizedFingerprint,
      rawObjectKey: input.artifacts.rawObjectKey,
      normalizedObjectKey: input.artifacts.normalizedObjectKey,
      rawByteLength: input.artifacts.rawByteLength,
      responseEtag: input.artifacts.responseEtag,
      responseLastModified: input.artifacts.responseLastModified,
      publicationAt: new Date(input.artifacts.publicationAt),
      detectedAt: new Date(input.artifacts.retrievedAt),
    });

    if (input.proposal) {
      await tx.insert(taxRuleUpdateReview).values({
        id: input.proposal.id,
        sourceId: input.source.id,
        baseRevisionId: input.expectedBaseRevisionId,
        candidateRevisionId,
        kind: input.proposal.kind,
        timing: input.proposal.timing,
        affectedRuleIds: input.proposal.affectedRuleIds,
        changes: input.proposal.changes,
        potentialEffectivePeriods:
          input.proposal.dates.potentialEffectivePeriods,
        publicationDate: input.proposal.dates.publicationDate,
        detectedDate: input.proposal.dates.detectedDate,
        activeDatasetVersion:
          input.proposal.activationGate.activeDatasetVersion,
        validationCommand: input.proposal.activationGate.validationCommand,
        previousArtifactMustRemain:
          input.proposal.activationGate.previousArtifactMustRemain,
      });
    }

    await tx
      .update(taxGuidanceSource)
      .set({
        lastSuccessfulCheckAt: new Date(input.artifacts.retrievedAt),
        updatedAt: new Date(),
      })
      .where(eq(taxGuidanceSource.id, input.source.id));
    return {
      revisionId: candidateRevisionId,
      reviewId: input.proposal?.id ?? null,
      repeated: false,
    };
  });
}
