import { apiRequest } from "@/lib/api/http";

export type TermKind = "ingredient" | "equipment";
export type TermResolutionAction =
  | "alias"
  | "new_canonical"
  | "merge"
  | "defer"
  | "reject"
  | "reversal";

export type TermReviewQueueItem = {
  kind: TermKind;
  normalizedText: string;
  locale: string;
  registryVersion: number;
  rawTexts: string[];
  submissionCount: number;
  tenantCount: number;
  lastSeenAt: string;
  localeReviewRequired: boolean;
  collisionReviewRequired: boolean;
  contexts: Array<{
    termId: string;
    observationKey: string;
    rawText: string;
    locale: string;
    sourceContext: {
      flow: "recipe" | "pantry" | "diet" | "equipment";
      resourceId?: string;
      field?: string;
    };
    provenance: {
      kind: "user" | "import";
      actorUserId: string;
      importJobId?: string;
    };
    candidateMatches: Array<{ slug: string; score: number }>;
    submissionCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
};

export type TermResolutionAuditItem = {
  id: string;
  kind: TermKind;
  normalizedText: string;
  locale: string;
  action: TermResolutionAction;
  targetSlug: string | null;
  canonicalName: string | null;
  rationale: string;
  evidence: string[];
  localeReview: boolean;
  collisionReview: boolean;
  decidedByUserId: string;
  reversesDecisionId: string | null;
  registryVersion: number;
  createdAt: string;
  reprojection: {
    status: "pending" | "running" | "succeeded" | "failed";
    attemptCount: number;
    projectedTermCount: number;
    projectedContextCount: number;
    lastError: string | null;
  } | null;
};

export async function loadTermReviewQueue(): Promise<TermReviewQueueItem[]> {
  const response = await apiRequest<{ items: TermReviewQueueItem[] }>(
    "/api/admin/term-resolutions/queue",
  );
  return response.items;
}

export async function loadTermResolutionAudit(): Promise<
  TermResolutionAuditItem[]
> {
  const response = await apiRequest<{ items: TermResolutionAuditItem[] }>(
    "/api/admin/term-resolutions/audit?limit=100",
  );
  return response.items;
}

export async function submitTermResolution(input: {
  target: Pick<TermReviewQueueItem, "kind" | "normalizedText" | "locale">;
  command: Record<string, unknown>;
}): Promise<void> {
  await apiRequest("/api/admin/term-resolutions", {
    method: "POST",
    json: {
      target: {
        kind: input.target.kind,
        normalizedText: input.target.normalizedText,
        locale: input.target.locale,
      },
      command: input.command,
    },
  });
}

export async function reverseTermResolution(
  item: TermResolutionAuditItem,
  rationale: string,
): Promise<void> {
  await submitTermResolution({
    target: item,
    command: {
      action: "reversal",
      idempotencyKey: crypto.randomUUID(),
      rationale,
      evidence: [],
      localeReview: false,
      collisionReview: false,
      reversesDecisionId: item.id,
    },
  });
}

export async function retryTermReprojection(decisionId: string): Promise<void> {
  await apiRequest(
    `/api/admin/term-resolutions/${encodeURIComponent(decisionId)}/reproject`,
    { method: "POST" },
  );
}
