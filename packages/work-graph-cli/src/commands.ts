import { createHash, randomUUID } from "node:crypto";
import { initTRPC } from "@trpc/server";
import { getCliContext, type TrpcCliMeta } from "trpc-cli";
import { z } from "zod";
import { WorkGraphClient, type Fetch } from "./client.js";
import { resolveClientConfig } from "./config.js";
import { usageError } from "./errors.js";
import {
  inspectGitHubPullRequest,
  type PullRequestInspector,
} from "./github.js";
import { updateFromCheckout, type SelfUpdater } from "./self-update.js";
import type {
  PullRequestSnapshot,
  ResolvedPullRequest,
  ResolvedWorkItemContext,
} from "./generated/client/types.gen.js";
import {
  zCreateAttentionRequestBody,
  zCreateAttentionRequestHeaders,
  zCreateAttentionResolutionBody,
  zCreateAttentionResolutionHeaders,
  zCreateAttentionResolutionPath,
  zCreateDependencyBody,
  zCreateDependencyHeaders,
  zCreateLeaseBody,
  zCreateKnowledgeScopeRelationshipBody,
  zCreateKnowledgeScopeRelationshipHeaders,
  zCreateLeaseRenewalBody,
  zCreateLeaseRenewalPath,
  zCreatePostReleaseWorkItemNoteBody,
  zCreateWorkItemBody,
  zCreateWorkItemDecompositionBody,
  zCreateWorkItemDecompositionHeaders,
  zCreateWorkItemNoteBody,
  zCreateWorkItemNoteHeaders,
  zCreateWorkItemReleaseBody,
  zExpediteWorkItemBody,
  zExpediteWorkItemHeaders,
  zGetKnowledgeScopePath,
  zGetWorkItemPath,
  zListAttentionRequestsQuery,
  zListKnowledgeScopeRelationshipsQuery,
  zListKnowledgeScopesQuery,
  zListWorkItemContextsPath,
  zListWorkItemDependenciesPath,
  zListWorkItemDependenciesQuery,
  zListWorkItemEventsPath,
  zListWorkItemEventsQuery,
  zListWorkItemLeasesPath,
  zListWorkItemLeasesQuery,
  zListWorkItemNotesPath,
  zListWorkItemNotesQuery,
  zListWorkItemPullRequestsPath,
  zListWorkItemsQuery,
  zMoveKnowledgeScopePriorityHeaders,
  zMoveWorkItemPriorityHeaders,
  zPutKnowledgeScopeBody,
  zPutKnowledgeScopeHeaders,
  zPutWorkItemPullRequestBody,
  zPutWorkItemPullRequestHeaders,
  zPutWorkItemContextBody,
  zPutWorkItemContextHeaders,
  zPutWorkItemParentBody,
  zPutWorkItemParentHeaders,
  zPutWorkItemReferenceBody,
  zPutWorkItemReferenceHeaders,
  zPutWorkItemSchedulingScopeHeaders,
  zPutWorkItemSchedulingScopePath,
  zRefreshPullRequestBody,
  zRefreshPullRequestHeaders,
  zUnexpediteWorkItemHeaders,
} from "./generated/client/zod.gen.js";

export type UuidFactory = () => string;

export interface CommandContext {
  environment: NodeJS.ProcessEnv;
  fetch?: Fetch;
  inspectPullRequest: PullRequestInspector;
  makeUuid: UuidFactory;
  selfUpdate: SelfUpdater;
  workingDirectory: string;
}

const mutationUuid = (
  context: CommandContext,
  idempotencyKey: string | undefined,
  role: string,
): string => {
  if (idempotencyKey === undefined) return context.makeUuid();

  const bytes = createHash("sha256")
    .update("work-graph-cli\0")
    .update(role)
    .update("\0")
    .update(idempotencyKey)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const globalOptionsSchema = z.object({
  apiUrl: z
    .string()
    .optional()
    .describe("API base URL (or WORK_GRAPH_API_URL)"),
  cfAccessAllowedOrigin: z
    .array(z.string())
    .default([])
    .describe("Exact origin trusted for Access headers; repeatable"),
});

const positional = <Schema extends z.ZodType>(
  schema: Schema,
  description: string,
): Schema => schema.describe(description).meta({ positional: true }) as Schema;

const described = <Schema extends z.ZodType>(
  schema: Schema,
  description: string,
): Schema => schema.describe(description) as Schema;

const optional = <Schema extends z.ZodType>(
  schema: Schema,
  description: string,
) => described(schema.optional(), description);

const idempotencyKey = described(
  zCreateWorkItemNoteHeaders.shape["idempotency-key"],
  "Client-generated UUID used to replay a mutation safely",
);

const [directLeaseBodySchema, scheduledLeaseBodySchema] =
  zCreateLeaseBody.options;
const leaseDuration = described(
  directLeaseBodySchema.shape.leaseDurationSeconds.default(900),
  "Lease duration in seconds",
);

const epoch = described(
  zCreateLeaseRenewalBody.shape.epoch,
  "Current lease fencing epoch",
);

const leaseFenceFields = {
  leaseId: optional(
    zCreateWorkItemNoteBody.shape.leaseId,
    "Lease UUID; omit with --epoch to use the ticket's active lease",
  ),
  epoch: optional(
    zCreateLeaseRenewalBody.shape.epoch,
    "Fencing epoch; omit with --lease-id to use the ticket's active lease",
  ),
};

const resolveLeaseFence = async (
  client: WorkGraphClient,
  workItemId: string,
  workerId: string | undefined,
  leaseId: string | undefined,
  leaseEpoch: number | undefined,
): Promise<{ leaseId: string; epoch: number }> => {
  if ((leaseId === undefined) !== (leaseEpoch === undefined)) {
    throw usageError(
      "Pass --lease-id and --epoch together, or omit both to use the ticket's active lease.",
    );
  }
  if (leaseId !== undefined && leaseEpoch !== undefined) {
    return { leaseId, epoch: leaseEpoch };
  }
  if (workerId === undefined) {
    throw usageError(
      "Set WORK_GRAPH_WORKER_ID or use a supported agent identity before resolving the ticket's active lease.",
    );
  }

  const workItem = await client.getWorkItem(workItemId);
  const lease = workItem.currentLease;
  if (lease?.endedAt !== null) {
    throw usageError(
      `Ticket ${workItemId} has no active lease. Claim it first with: work-graph claim ${workItemId}`,
    );
  }
  if (lease.workerId !== workerId) {
    throw usageError(
      `Ticket ${workItemId} is claimed by ${lease.workerId}, not ${workerId}.`,
    );
  }
  return { leaseId: lease.id, epoch: lease.epoch };
};

const jsonArray = <Schema extends z.ZodArray>(
  schema: Schema,
  description: string,
) =>
  z
    .string()
    .describe(description)
    .transform((value, context) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        context.addIssue({ code: "custom", message: "must be valid JSON" });
        return z.NEVER;
      }
      const result = schema.safeParse(parsed);
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({
            code: "custom",
            message: issue.message,
            path: [...issue.path],
          });
        }
        return z.NEVER;
      }
      return result.data;
    });

const resolveClient = (context: CommandContext): WorkGraphClient => {
  const rawOptions = getCliContext()?.program.opts() ?? {};
  const parsed = globalOptionsSchema.safeParse(rawOptions);
  if (!parsed.success) throw usageError(z.prettifyError(parsed.error));

  const config = resolveClientConfig(
    {
      apiUrl: parsed.data.apiUrl,
      accessAllowedOrigins: parsed.data.cfAccessAllowedOrigin,
    },
    context.environment,
  );
  return new WorkGraphClient(config, context.fetch);
};

const workerIdentity = (environment: NodeJS.ProcessEnv): string | undefined => {
  if (environment.WORK_GRAPH_WORKER_ID) {
    return environment.WORK_GRAPH_WORKER_ID;
  }
  const codexId = environment.CODEX_THREAD_ID ?? environment.CODEX_SESSION_ID;
  return codexId === undefined ? undefined : `codex:${codexId}`;
};

const pullRequestStatus = (snapshot: PullRequestSnapshot): string => {
  const parts: string[] = [snapshot.state];
  if (snapshot.draft) parts.push("draft");
  if (snapshot.mergeability === "conflicting") parts.push("conflicting");
  parts.push(`checks ${snapshot.checkSummary}`);
  if (snapshot.reviewDecision !== null) {
    parts.push(snapshot.reviewDecision.replaceAll("_", " "));
  }
  return parts.join(", ");
};

const compactPullRequest = (context: ResolvedPullRequest) => ({
  kind: context.kind,
  role: context.role,
  ref: `${context.pullRequest.repository}#${context.pullRequest.number}`,
  url: context.pullRequest.url,
  status: pullRequestStatus(context.pullRequest),
  observedAt: context.pullRequest.observedAt,
  ...(context.inheritanceDepth === 0
    ? {}
    : { inheritedFrom: context.sourceWorkItemId }),
});

const compactPullRequestsInContext = (
  contexts: readonly ResolvedWorkItemContext[],
) =>
  contexts.map((context) =>
    context.kind === "pull_request" ? compactPullRequest(context) : context,
  );

const t = initTRPC
  .context<CommandContext>()
  .meta<TrpcCliMeta>()
  .create();
const command = t.procedure;

const createInput = z.object({
  id: positional(zCreateWorkItemBody.shape.id, "Ticket ID"),
  title: described(zCreateWorkItemBody.shape.title, "Ticket title"),
  parentId: optional(
    zCreateWorkItemBody.shape.parentId.unwrap().unwrap(),
    "Parent ticket ID",
  ),
  schedulingInitiativeId: optional(
    zCreateWorkItemBody.shape.schedulingInitiativeId.unwrap().unwrap(),
    "Initiative used for scheduling",
  ),
  schedulingProjectId: optional(
    zCreateWorkItemBody.shape.schedulingProjectId.unwrap().unwrap(),
    "Project used for ticket ranking",
  ),
  idempotencyKey,
});

const [putTextContextBodySchema, putArchitectureDecisionBodySchema] =
  zPutWorkItemContextBody.options;

const contextShowInput = z.object({
  workItemId: positional(
    zListWorkItemContextsPath.shape.workItemId,
    "Ticket ID",
  ),
  fullPrContext: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include full pull-request snapshots"),
});

const contextPutInput = z.object({
  workItemId: positional(
    zListWorkItemContextsPath.shape.workItemId,
    "Ticket ID",
  ),
  kind: described(
    putTextContextBodySchema.shape.kind,
    "Context kind",
  ),
  content: described(
    putTextContextBodySchema.shape.content,
    "Brief or acceptance criteria",
  ),
  idempotencyKey: described(
    zPutWorkItemContextHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const contextArchitectureDecisionInput = z.object({
  workItemId: positional(
    zListWorkItemContextsPath.shape.workItemId,
    "Ticket ID",
  ),
  title: described(
    putArchitectureDecisionBodySchema.shape.title,
    "Architecture decision title",
  ),
  url: described(
    putArchitectureDecisionBodySchema.shape.url,
    "Architecture decision URL",
  ),
  role: described(
    putArchitectureDecisionBodySchema.shape.role,
    "Decision role",
  ),
  idempotencyKey: described(
    zPutWorkItemContextHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const referencePutInput = z.object({
  workItemId: positional(
    zListWorkItemContextsPath.shape.workItemId,
    "Ticket ID",
  ),
  title: described(zPutWorkItemReferenceBody.shape.title, "Reference title"),
  url: described(zPutWorkItemReferenceBody.shape.url, "Reference URL"),
  idempotencyKey: described(
    zPutWorkItemReferenceHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const pullRequestShowInput = z.object({
  workItemId: positional(
    zListWorkItemPullRequestsPath.shape.workItemId,
    "Ticket ID",
  ),
  full: z
    .boolean()
    .optional()
    .default(false)
    .describe("Show the full stored snapshots"),
});

const pullRequestAttachInput = z.object({
  workItemId: positional(
    zListWorkItemPullRequestsPath.shape.workItemId,
    "Ticket ID",
  ),
  url: positional(z.url(), "GitHub pull-request URL"),
  role: described(zPutWorkItemPullRequestBody.shape.role, "Link role"),
  idempotencyKey: described(
    zPutWorkItemPullRequestHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay both mutations safely",
  ),
});

const pullRequestLinkInput = z.object({
  workItemId: positional(
    zListWorkItemPullRequestsPath.shape.workItemId,
    "Ticket ID",
  ),
  repository: described(
    zPutWorkItemPullRequestBody.shape.repository,
    "Repository in owner/name form",
  ),
  number: described(
    zPutWorkItemPullRequestBody.shape.number,
    "Pull-request number",
  ),
  role: described(zPutWorkItemPullRequestBody.shape.role, "Link role"),
  idempotencyKey: described(
    zPutWorkItemPullRequestHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const pullRequestReviewDecisionSchema =
  zRefreshPullRequestBody.shape.reviewDecision.unwrap();

const pullRequestRefreshInput = z.object({
  repository: described(
    zRefreshPullRequestBody.shape.repository,
    "Repository in owner/name form",
  ),
  number: described(
    zRefreshPullRequestBody.shape.number,
    "Pull-request number",
  ),
  url: described(zRefreshPullRequestBody.shape.url, "Pull-request URL"),
  headSha: described(zRefreshPullRequestBody.shape.headSha, "Head commit SHA"),
  state: described(zRefreshPullRequestBody.shape.state, "Pull-request state"),
  draft: zRefreshPullRequestBody.shape.draft
    .optional()
    .default(false)
    .describe("Mark the pull request as a draft"),
  mergeability: described(
    zRefreshPullRequestBody.shape.mergeability,
    "Mergeability summary",
  ),
  reviewDecision: optional(
    pullRequestReviewDecisionSchema,
    "Review decision",
  ),
  checkSummary: described(
    zRefreshPullRequestBody.shape.checkSummary,
    "Aggregate check result",
  ),
  observedAt: optional(
    zRefreshPullRequestBody.shape.observedAt,
    "Snapshot observation time",
  ),
  idempotencyKey: described(
    zRefreshPullRequestHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const scopeListInput = z.object({
  kind: optional(
    zListKnowledgeScopesQuery.shape.kind.unwrap(),
    "Knowledge-scope kind",
  ),
  limit: optional(
    zListKnowledgeScopesQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of knowledge scopes",
  ),
  cursor: optional(
    zListKnowledgeScopesQuery.shape.cursor.unwrap(),
    "Pagination cursor",
  ),
});

const scopePutInput = z.object({
  knowledgeScopeId: positional(
    zGetKnowledgeScopePath.shape.knowledgeScopeId,
    "Stable knowledge-scope source key",
  ),
  kind: described(zPutKnowledgeScopeBody.shape.kind, "Knowledge-scope kind"),
  title: described(zPutKnowledgeScopeBody.shape.title, "Source title snapshot"),
  canonicalUrl: described(
    zPutKnowledgeScopeBody.shape.canonicalUrl,
    "Canonical HTML URL",
  ),
  markdownUrl: described(
    zPutKnowledgeScopeBody.shape.markdownUrl,
    "Canonical Markdown URL",
  ),
  sourceRevision: optional(
    zPutKnowledgeScopeBody.shape.sourceRevision.unwrap().unwrap(),
    "Source revision",
  ),
  idempotencyKey: described(
    zPutKnowledgeScopeHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const priorityMoveFields = {
  above: optional(
    zGetWorkItemPath.shape.workItemId,
    "Place immediately above this ID",
  ),
  below: optional(
    zGetWorkItemPath.shape.workItemId,
    "Place immediately below this ID",
  ),
};

const priorityMoveBody = (
  above: string | undefined,
  below: string | undefined,
):
  | { readonly higherThanId: string; readonly lowerThanId?: string }
  | { readonly higherThanId?: string; readonly lowerThanId: string } => {
  if (above !== undefined) {
    return {
      higherThanId: above,
      ...(below === undefined ? {} : { lowerThanId: below }),
    };
  }
  if (below !== undefined) return { lowerThanId: below };
  throw usageError("Pass --above or --below.");
};

const workItemPriorityMoveInput = z
  .object({
    workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
    ...priorityMoveFields,
    idempotencyKey: described(
      zMoveWorkItemPriorityHeaders.shape["idempotency-key"],
      "Client-generated UUID used to replay a mutation safely",
    ),
  })
  .refine(({ above, below }) => above || below, {
    message: "Pass --above or --below.",
  });

const scopePriorityMoveInput = z
  .object({
    knowledgeScopeId: positional(
      zGetKnowledgeScopePath.shape.knowledgeScopeId,
      "Knowledge-scope ID",
    ),
    above: optional(
      zGetKnowledgeScopePath.shape.knowledgeScopeId,
      "Place immediately above this scope",
    ),
    below: optional(
      zGetKnowledgeScopePath.shape.knowledgeScopeId,
      "Place immediately below this scope",
    ),
    idempotencyKey: described(
      zMoveKnowledgeScopePriorityHeaders.shape["idempotency-key"],
      "Client-generated UUID used to replay a mutation safely",
    ),
  })
  .refine(({ above, below }) => above || below, {
    message: "Pass --above or --below.",
  });

const expediteInput = z.object({
  workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
  reason: described(zExpediteWorkItemBody.shape.reason, "Expedite reason"),
  idempotencyKey: described(
    zExpediteWorkItemHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const unexpediteInput = z.object({
  workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
  idempotencyKey: described(
    zUnexpediteWorkItemHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const reparentInput = z.object({
  workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
  parentId: positional(
    zPutWorkItemParentBody.shape.parentId.unwrap(),
    "New parent ticket ID",
  ),
  idempotencyKey: described(
    zPutWorkItemParentHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const detachInput = z.object({
  workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
  idempotencyKey: described(
    zPutWorkItemParentHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const scopeRelationshipInput = z.object({
  parentKnowledgeScopeId: positional(
    zCreateKnowledgeScopeRelationshipBody.shape.parentKnowledgeScopeId,
    "Parent knowledge-scope source key",
  ),
  childKnowledgeScopeId: positional(
    zCreateKnowledgeScopeRelationshipBody.shape.childKnowledgeScopeId,
    "Child knowledge-scope source key",
  ),
  idempotencyKey: described(
    zCreateKnowledgeScopeRelationshipHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const scopeRelationshipListInput = z.object({
  limit: optional(
    zListKnowledgeScopeRelationshipsQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of knowledge-scope relationships",
  ),
  cursor: optional(
    zListKnowledgeScopeRelationshipsQuery.shape.cursor.unwrap(),
    "Opaque relationship cursor",
  ),
});

const scopeAssignmentInput = z.object({
  workItemId: positional(
    zPutWorkItemSchedulingScopePath.shape.workItemId,
    "Root ticket ID",
  ),
  initiativeId: optional(
    zListWorkItemsQuery.shape.initiativeId.unwrap(),
    "Scheduling initiative ID; omit with project to infer its parent",
  ),
  projectId: optional(
    zListWorkItemsQuery.shape.projectId.unwrap(),
    "Scheduling project ID; omit both scope flags to clear the assignment",
  ),
  idempotencyKey: described(
    zPutWorkItemSchedulingScopeHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const dependencyInput = z.object({
  dependentWorkItemId: positional(
    zCreateDependencyBody.shape.dependentWorkItemId,
    "Dependent ticket ID",
  ),
  blockerWorkItemId: positional(
    zCreateDependencyBody.shape.blockerWorkItemId,
    "Blocker ticket ID",
  ),
  idempotencyKey: described(
    zCreateDependencyHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const queueInput = z
  .object({
    stage: optional(zListWorkItemsQuery.shape.stage.unwrap(), "Stage to list"),
    all: z
      .boolean()
      .optional()
      .describe("List all stages instead of the ready queue"),
    limit: optional(
      zListWorkItemsQuery.shape.limit.unwrap().unwrap(),
      "Maximum number of tickets",
    ),
    cursor: optional(
      zListWorkItemsQuery.shape.cursor.unwrap(),
      "Pagination cursor",
    ),
    initiativeId: optional(
      zListWorkItemsQuery.shape.initiativeId.unwrap(),
      "Only tickets scheduled in this initiative",
    ),
    projectId: optional(
      zListWorkItemsQuery.shape.projectId.unwrap(),
      "Only tickets scheduled in this project",
    ),
    parentId: optional(
      zListWorkItemsQuery.shape.parentId.unwrap(),
      "Only direct children of this ticket",
    ),
  })
  .refine((input) => !(input.all && input.stage), {
    message: "--all and --stage cannot be used together",
    path: ["all"],
  });

const readyInput = z.object({
  limit: optional(
    zListWorkItemsQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of tickets",
  ),
  cursor: optional(
    zListWorkItemsQuery.shape.cursor.unwrap(),
    "Pagination cursor",
  ),
  initiativeId: optional(
    zListWorkItemsQuery.shape.initiativeId.unwrap(),
    "Only tickets scheduled in this initiative",
  ),
  projectId: optional(
    zListWorkItemsQuery.shape.projectId.unwrap(),
    "Only tickets scheduled in this project",
  ),
  parentId: optional(
    zListWorkItemsQuery.shape.parentId.unwrap(),
    "Only direct children of this ticket",
  ),
});

const claimInput = z.object({
  workItemId: positional(
    optional(directLeaseBodySchema.shape.workItemId, "Ticket ID"),
    "Ticket ID",
  ),
  workerId: optional(directLeaseBodySchema.shape.workerId, "Worker identity"),
  leaseDurationSeconds: leaseDuration,
  initiativeId: optional(
    scheduledLeaseBodySchema.shape.initiativeId.unwrap(),
    "Claim within this initiative",
  ),
  projectId: optional(
    scheduledLeaseBodySchema.shape.projectId.unwrap(),
    "Claim within this project",
  ),
  parentId: optional(
    scheduledLeaseBodySchema.shape.parentId.unwrap(),
    "Claim a direct child of this ticket",
  ),
  fullPrContext: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include full pull-request snapshots in claim context"),
}).refine(
  ({ initiativeId, parentId, projectId, workItemId }) =>
    workItemId === undefined ||
    (initiativeId === undefined &&
      parentId === undefined &&
      projectId === undefined),
  {
    message: "A specified ticket cannot be combined with scope filters.",
    path: ["workItemId"],
  },
);

const noteInput = z.object({
  workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
  id: optional(
    zCreateWorkItemNoteBody.shape.id,
    "Note UUID (generated by default)",
  ),
  ...leaseFenceFields,
  content: described(zCreateWorkItemNoteBody.shape.content, "Note text"),
  idempotencyKey,
});

const commentInput = z.object({
  workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
  id: optional(
    zCreatePostReleaseWorkItemNoteBody.shape.id,
    "Note UUID (generated by default)",
  ),
  author: optional(
    zCreatePostReleaseWorkItemNoteBody.shape.author,
    "Author provenance (or WORK_GRAPH_WORKER_ID)",
  ),
  content: described(
    zCreatePostReleaseWorkItemNoteBody.shape.content,
    "Post-release discussion text",
  ),
  idempotencyKey,
});

const renewInput = z.object({
  leaseId: positional(zCreateLeaseRenewalPath.shape.leaseId, "Lease UUID"),
  epoch,
  leaseDurationSeconds: leaseDuration,
});

const decompositionChildren = zCreateWorkItemDecompositionBody.shape.children;
const decompositionDependencies =
  zCreateWorkItemDecompositionBody.shape.dependencies.unwrap();
const decompositionClaim = zCreateWorkItemDecompositionBody.shape.claim.unwrap();

const decomposeInput = z
  .object({
    workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
    ...leaseFenceFields,
    childrenJson: jsonArray(
      decompositionChildren,
      "Contract-shaped JSON array of child tickets",
    ),
    dependenciesJson: jsonArray(
      decompositionDependencies,
      "Contract-shaped JSON array of dependencies",
    ).optional(),
    claimWorkItemId: optional(
      decompositionClaim.shape.workItemId,
      "Child ticket ID to claim atomically",
    ),
    claimLeaseId: optional(
      decompositionClaim.shape.leaseId,
      "UUID for the child lease (generated by default)",
    ),
    claimLeaseDurationSeconds: optional(
      decompositionClaim.shape.leaseDurationSeconds,
      "Child lease duration in seconds (default: 900)",
    ),
    idempotencyKey: described(
      zCreateWorkItemDecompositionHeaders.shape["idempotency-key"],
      "Client-generated UUID used to replay a mutation safely",
    ),
  })
  .superRefine((input, context) => {
    if (!input.claimWorkItemId && input.claimLeaseId) {
      context.addIssue({
        code: "custom",
        message: "--claim-lease-id requires --claim-work-item-id",
        path: ["claimLeaseId"],
      });
    }
    if (!input.claimWorkItemId && input.claimLeaseDurationSeconds) {
      context.addIssue({
        code: "custom",
        message:
          "--claim-lease-duration-seconds requires --claim-work-item-id",
        path: ["claimLeaseDurationSeconds"],
      });
    }
  });

const attentionListInput = z.object({
  state: optional(
    zListAttentionRequestsQuery.shape.state.unwrap().unwrap(),
    "Resolution state (default: unresolved)",
  ),
  blocking: optional(
    zListAttentionRequestsQuery.shape.blocking.unwrap(),
    "Filter by blocking status",
  ),
  limit: optional(
    zListAttentionRequestsQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of attention requests",
  ),
  cursor: optional(
    zListAttentionRequestsQuery.shape.cursor.unwrap(),
    "Pagination cursor UUID",
  ),
});

const attentionRequestInput = z.object({
  workItemId: positional(
    zCreateAttentionRequestBody.shape.workItemId,
    "Ticket ID",
  ),
  id: optional(
    zCreateAttentionRequestBody.shape.id,
    "Attention-request UUID (generated by default)",
  ),
  ...leaseFenceFields,
  kind: described(zCreateAttentionRequestBody.shape.kind, "Request kind"),
  question: described(
    zCreateAttentionRequestBody.shape.question,
    "Question requiring attention",
  ),
  note: optional(zCreateAttentionRequestBody.shape.note.unwrap(), "Context note"),
  nonBlocking: z
    .boolean()
    .optional()
    .describe("Mark the attention request as non-blocking"),
  idempotencyKey: described(
    zCreateAttentionRequestHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const attentionResolveInput = z.object({
  attentionRequestId: positional(
    zCreateAttentionResolutionPath.shape.attentionRequestId,
    "Attention-request UUID",
  ),
  id: optional(
    zCreateAttentionResolutionBody.shape.id,
    "Resolution UUID (generated by default)",
  ),
  resolution: described(
    zCreateAttentionResolutionBody.shape.resolution,
    "Resolution text",
  ),
  idempotencyKey: described(
    zCreateAttentionResolutionHeaders.shape["idempotency-key"],
    "Client-generated UUID used to replay a mutation safely",
  ),
});

const terminationInput = z.object({
  workItemId: positional(zGetWorkItemPath.shape.workItemId, "Ticket ID"),
  ...leaseFenceFields,
});

const releaseInput = terminationInput.extend({
  mergeEvidence: described(
    zCreateWorkItemReleaseBody.shape.mergeEvidence,
    "Merged pull request, commit, or equivalent evidence",
  ),
  deploymentEvidence: described(
    zCreateWorkItemReleaseBody.shape.deploymentEvidence,
    "Production deployment and verification evidence",
  ),
});

const metadataNotesInput = z.object({
  workItemId: positional(
    zListWorkItemNotesPath.shape.workItemId,
    "Ticket ID",
  ),
  limit: optional(
    zListWorkItemNotesQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of notes",
  ),
  cursor: optional(
    zListWorkItemNotesQuery.shape.cursor.unwrap(),
    "Pagination cursor UUID",
  ),
});

const metadataEventsInput = z.object({
  workItemId: positional(
    zListWorkItemEventsPath.shape.workItemId,
    "Ticket ID",
  ),
  type: optional(
    zListWorkItemEventsQuery.shape.type.unwrap(),
    "Event type",
  ),
  limit: optional(
    zListWorkItemEventsQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of events",
  ),
  afterSequence: optional(
    zListWorkItemEventsQuery.shape.afterSequence.unwrap(),
    "Continue after this event sequence",
  ),
});

const metadataDependenciesInput = z.object({
  workItemId: positional(
    zListWorkItemDependenciesPath.shape.workItemId,
    "Ticket ID",
  ),
  limit: optional(
    zListWorkItemDependenciesQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of dependency edges",
  ),
  cursor: optional(
    zListWorkItemDependenciesQuery.shape.cursor.unwrap(),
    "Opaque dependency cursor",
  ),
});

const metadataLeasesInput = z.object({
  workItemId: positional(
    zListWorkItemLeasesPath.shape.workItemId,
    "Ticket ID",
  ),
  limit: optional(
    zListWorkItemLeasesQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of leases",
  ),
  afterEpoch: optional(
    zListWorkItemLeasesQuery.shape.afterEpoch.unwrap(),
    "Continue after this lease epoch",
  ),
});

const metadataAttentionInput = z.object({
  workItemId: positional(
    zListAttentionRequestsQuery.shape.workItemId.unwrap(),
    "Ticket ID",
  ),
  limit: optional(
    zListAttentionRequestsQuery.shape.limit.unwrap().unwrap(),
    "Maximum number of attention requests",
  ),
  cursor: optional(
    zListAttentionRequestsQuery.shape.cursor.unwrap(),
    "Pagination cursor UUID",
  ),
});

const listQueue = (
  context: CommandContext,
  input: z.infer<typeof queueInput>,
) =>
  resolveClient(context).listWorkItems({
    ...(input.all ? {} : { stage: input.stage ?? "ready" }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.initiativeId === undefined
      ? {}
      : { initiativeId: input.initiativeId }),
    ...(input.projectId === undefined
      ? {}
      : { projectId: input.projectId }),
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
  });

export const workGraphRouter = t.router({
  prime: command
    .meta({ description: "Print the short agent workflow" })
    .input(z.object({}))
    .query(({ ctx }) => ({
      workerId: workerIdentity(ctx.environment) ?? null,
      auth:
        ctx.environment.WORK_GRAPH_API_URL === undefined
          ? "Doppler loads production credentials automatically for API commands."
          : "configured",
      workflow: [
        "work-graph ready",
        "work-graph claim [ticket]",
        'work-graph note <ticket> --content "progress or handoff"',
        "work-graph release <ticket> --merge-evidence <url> --deployment-evidence <url>",
      ],
      rules: [
        "Codex thread identity is automatic; WORK_GRAPH_WORKER_ID overrides it.",
        "Ticket commands find the active lease and fencing epoch automatically.",
        "Use attention request for a blocking decision; use cancel only when the outcome is no longer wanted.",
        "After pulling a merged CLI change, run work-graph self-update from the checkout.",
      ],
    })),
  selfUpdate: command
    .meta({ description: "Build and install the CLI from a source checkout" })
    .input(
      z.object({
        sourceDirectory: optional(
          z.string().min(1),
          "Repository checkout; defaults to the current directory",
        ),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.selfUpdate(input.sourceDirectory ?? ctx.workingDirectory),
    ),
  ready: command
    .meta({ description: "List ready tickets in priority order" })
    .input(readyInput)
    .query(({ ctx, input }) => listQueue(ctx, input)),
  metadata: t.router({
    notes: command
      .meta({ description: "List ticket notes" })
      .input(metadataNotesInput)
      .query(({ ctx, input }) =>
        resolveClient(ctx).listWorkItemNotes(input.workItemId, {
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
    events: command
      .meta({ description: "List immutable ticket events" })
      .input(metadataEventsInput)
      .query(({ ctx, input }) =>
        resolveClient(ctx).listWorkItemEvents(input.workItemId, {
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.afterSequence === undefined
            ? {}
            : { afterSequence: input.afterSequence }),
        }),
      ),
    dependencies: command
      .meta({ description: "List dependency edges involving a ticket" })
      .input(metadataDependenciesInput)
      .query(({ ctx, input }) =>
        resolveClient(ctx).listWorkItemDependencies(input.workItemId, {
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
    decompositions: command
      .meta({ description: "List ticket decomposition history" })
      .input(metadataEventsInput.omit({ type: true }))
      .query(({ ctx, input }) =>
        resolveClient(ctx).listWorkItemEvents(input.workItemId, {
          type: "work_item.decomposed",
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.afterSequence === undefined
            ? {}
            : { afterSequence: input.afterSequence }),
        }),
      ),
    leases: command
      .meta({ description: "List ticket lease history" })
      .input(metadataLeasesInput)
      .query(({ ctx, input }) =>
        resolveClient(ctx).listWorkItemLeases(input.workItemId, {
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.afterEpoch === undefined
            ? {}
            : { afterEpoch: input.afterEpoch }),
        }),
      ),
    attention: command
      .meta({ description: "List ticket attention history" })
      .input(metadataAttentionInput)
      .query(({ ctx, input }) =>
        resolveClient(ctx).listAttention({
          workItemId: input.workItemId,
          state: "all",
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
    cancellations: command
      .meta({ description: "List ticket cancellation history" })
      .input(metadataEventsInput.omit({ type: true }))
      .query(({ ctx, input }) =>
        resolveClient(ctx).listWorkItemEvents(input.workItemId, {
          type: "work_item.lifecycle_changed",
          lifecycle: "cancelled",
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.afterSequence === undefined
            ? {}
            : { afterSequence: input.afterSequence }),
        }),
      ),
    releases: command
      .meta({ description: "List ticket release evidence" })
      .input(metadataEventsInput.omit({ type: true }))
      .query(({ ctx, input }) =>
        resolveClient(ctx).listWorkItemEvents(input.workItemId, {
          type: "work_item.lifecycle_changed",
          lifecycle: "released",
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.afterSequence === undefined
            ? {}
            : { afterSequence: input.afterSequence }),
        }),
      ),
  }),
  dependency: t.router({
    add: command
      .meta({ description: "Add a ticket dependency" })
      .input(dependencyInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).addDependency(
          {
            dependentWorkItemId: input.dependentWorkItemId,
            blockerWorkItemId: input.blockerWorkItemId,
          },
          input.idempotencyKey,
        ),
      ),
    remove: command
      .meta({ description: "Remove a ticket dependency" })
      .input(dependencyInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).removeDependency(
          {
            dependentWorkItemId: input.dependentWorkItemId,
            blockerWorkItemId: input.blockerWorkItemId,
          },
          input.idempotencyKey,
        ),
      ),
  }),
  scope: t.router({
    list: command
      .meta({ description: "List knowledge-scope mirrors" })
      .input(scopeListInput)
      .query(({ ctx, input }) =>
        resolveClient(ctx).listKnowledgeScopes({
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
    show: command
      .meta({ description: "Show a knowledge-scope mirror" })
      .input(
        z.object({
          knowledgeScopeId: positional(
            zGetKnowledgeScopePath.shape.knowledgeScopeId,
            "Stable knowledge-scope source key",
          ),
        }),
      )
      .query(({ ctx, input }) =>
        resolveClient(ctx).getKnowledgeScope(input.knowledgeScopeId),
      ),
    put: command
      .meta({ description: "Create or replace a knowledge-scope mirror" })
      .input(scopePutInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).putKnowledgeScope(
          input.knowledgeScopeId,
          {
            kind: input.kind,
            title: input.title,
            canonicalUrl: input.canonicalUrl,
            markdownUrl: input.markdownUrl,
            ...(input.sourceRevision === undefined
              ? {}
              : { sourceRevision: input.sourceRevision }),
          },
          input.idempotencyKey,
        ),
      ),
    move: command
      .meta({ description: "Move a scope within its contextual priority list" })
      .input(scopePriorityMoveInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).moveKnowledgeScopePriority(
          input.knowledgeScopeId,
          priorityMoveBody(input.above, input.below),
          input.idempotencyKey,
        ),
      ),
    assign: command
      .meta({ description: "Assign a root ticket to scheduling scopes" })
      .input(scopeAssignmentInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).putWorkItemSchedulingScope(
          input.workItemId,
          {
            schedulingInitiativeId: input.initiativeId ?? null,
            schedulingProjectId: input.projectId ?? null,
          },
          input.idempotencyKey,
        ),
      ),
    links: command
      .meta({ description: "List knowledge-scope relationships" })
      .input(scopeRelationshipListInput)
      .query(({ ctx, input }) =>
        resolveClient(ctx).listKnowledgeScopeRelationships({
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
    link: command
      .meta({ description: "Add a knowledge-scope relationship" })
      .input(scopeRelationshipInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).addKnowledgeScopeRelationship(
          {
            parentKnowledgeScopeId: input.parentKnowledgeScopeId,
            childKnowledgeScopeId: input.childKnowledgeScopeId,
          },
          input.idempotencyKey,
        ),
      ),
    unlink: command
      .meta({ description: "Remove a knowledge-scope relationship" })
      .input(scopeRelationshipInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).removeKnowledgeScopeRelationship(
          {
            parentKnowledgeScopeId: input.parentKnowledgeScopeId,
            childKnowledgeScopeId: input.childKnowledgeScopeId,
          },
          input.idempotencyKey,
        ),
      ),
  }),
  create: command
    .meta({ description: "Create a ticket" })
    .input(createInput)
    .mutation(({ ctx, input }) =>
      resolveClient(ctx).createWorkItem(
        {
          id: input.id,
          title: input.title,
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          ...(input.schedulingInitiativeId === undefined
            ? {}
            : { schedulingInitiativeId: input.schedulingInitiativeId }),
          ...(input.schedulingProjectId === undefined
            ? {}
            : { schedulingProjectId: input.schedulingProjectId }),
        },
        input.idempotencyKey,
      ),
    ),
  context: t.router({
    show: command
      .meta({ description: "Show resolved context in claim order" })
      .input(contextShowInput)
      .query(async ({ ctx, input }) => {
        const result = await resolveClient(ctx).listWorkItemContexts(
          input.workItemId,
        );
        return input.fullPrContext
          ? result
          : { ...result, items: compactPullRequestsInContext(result.items) };
      }),
    put: command
      .meta({ description: "Create or replace a brief or acceptance criteria" })
      .input(contextPutInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).putWorkItemContext(
          input.workItemId,
          { kind: input.kind, content: input.content },
          input.idempotencyKey,
        ),
      ),
    adr: command
      .meta({ description: "Create or replace an architecture-decision link" })
      .input(contextArchitectureDecisionInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).putWorkItemContext(
          input.workItemId,
          {
            kind: "architecture_decision",
            title: input.title,
            url: input.url,
            role: input.role,
          },
          input.idempotencyKey,
        ),
      ),
  }),
  reference: t.router({
    put: command
      .meta({ description: "Create or replace a supplemental reference" })
      .input(referencePutInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).putWorkItemReference(
          input.workItemId,
          { title: input.title, url: input.url },
          input.idempotencyKey,
        ),
      ),
  }),
  pr: t.router({
    show: command
      .meta({ description: "Show compact pull requests in claim-context order" })
      .input(pullRequestShowInput)
      .query(async ({ ctx, input }) => {
        const result = await resolveClient(ctx).listWorkItemPullRequests(
          input.workItemId,
        );
        return input.full
          ? result
          : { items: result.items.map(compactPullRequest) };
      }),
    attach: command
      .meta({
        description: "Inspect a GitHub pull request, refresh it, and link it",
      })
      .input(pullRequestAttachInput)
      .mutation(async ({ ctx, input }) => {
        const client = resolveClient(ctx);
        const snapshot = await ctx.inspectPullRequest(input.url);
        const refreshKey =
          input.idempotencyKey === undefined
            ? undefined
            : mutationUuid(ctx, input.idempotencyKey, "pr-attach-refresh");
        const linkKey =
          input.idempotencyKey === undefined
            ? undefined
            : mutationUuid(ctx, input.idempotencyKey, "pr-attach-link");
        const refreshedSnapshot = await client.refreshPullRequest(
          snapshot,
          refreshKey,
        );
        await client.putWorkItemPullRequest(
          input.workItemId,
          {
            repository: refreshedSnapshot.repository,
            number: refreshedSnapshot.number,
            role: input.role,
          },
          linkKey,
        );
        return {
          workItemId: input.workItemId,
          ...compactPullRequest({
            kind: "pull_request",
            role: input.role,
            pullRequest: refreshedSnapshot,
            sourceWorkItemId: input.workItemId,
            inheritanceDepth: 0,
          }),
        };
      }),
    link: command
      .meta({ description: "Low-level link of a stored pull request" })
      .input(pullRequestLinkInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).putWorkItemPullRequest(
          input.workItemId,
          {
            repository: input.repository,
            number: input.number,
            role: input.role,
          },
          input.idempotencyKey,
        ),
      ),
    refresh: command
      .meta({ description: "Low-level pull-request snapshot refresh" })
      .input(pullRequestRefreshInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).refreshPullRequest(
          {
            repository: input.repository,
            number: input.number,
            url: input.url,
            headSha: input.headSha,
            state: input.state,
            draft: input.draft,
            mergeability: input.mergeability,
            reviewDecision: input.reviewDecision ?? null,
            checkSummary: input.checkSummary,
            observedAt: input.observedAt ?? new Date().toISOString(),
          },
          input.idempotencyKey,
        ),
      ),
  }),
  priority: t.router({
    move: command
      .meta({ description: "Move a ticket within its project priority list" })
      .input(workItemPriorityMoveInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).moveWorkItemPriority(
          input.workItemId,
          priorityMoveBody(input.above, input.below),
          input.idempotencyKey,
        ),
      ),
  }),
  reparent: command
    .meta({ description: "Move a ticket under a different parent" })
    .input(reparentInput)
    .mutation(({ ctx, input }) =>
      resolveClient(ctx).putWorkItemParent(
        input.workItemId,
        { parentId: input.parentId },
        input.idempotencyKey,
      ),
    ),
  detach: command
    .meta({ description: "Move a ticket to the graph root" })
    .input(detachInput)
    .mutation(({ ctx, input }) =>
      resolveClient(ctx).putWorkItemParent(
        input.workItemId,
        { parentId: null },
        input.idempotencyKey,
      ),
    ),
  expedite: command
    .meta({ description: "Expedite a ticket and donate urgency to blockers" })
    .input(expediteInput)
    .mutation(({ ctx, input }) =>
      resolveClient(ctx).expediteWorkItem(
        input.workItemId,
        { reason: input.reason },
        input.idempotencyKey,
      ),
    ),
  unexpedite: command
    .meta({ description: "Remove a ticket expedite" })
    .input(unexpediteInput)
    .mutation(({ ctx, input }) =>
      resolveClient(ctx).unexpediteWorkItem(
        input.workItemId,
        input.idempotencyKey,
      ),
    ),
  queue: command
    .meta({ description: "List queued tickets" })
    .input(queueInput)
    .query(({ ctx, input }) => listQueue(ctx, input)),
  claim: command
    .meta({ description: "Claim the next ready ticket or a specified ticket" })
    .input(claimInput)
    .mutation(async ({ ctx, input }) => {
      const workerId = input.workerId ?? workerIdentity(ctx.environment);
      if (!workerId) {
        throw usageError("Set WORK_GRAPH_WORKER_ID or pass --worker-id.");
      }
      const body =
        input.workItemId === undefined
          ? {
              workerId,
              leaseDurationSeconds: input.leaseDurationSeconds,
              ...(input.initiativeId === undefined
                ? {}
                : { initiativeId: input.initiativeId }),
              ...(input.projectId === undefined
                ? {}
                : { projectId: input.projectId }),
              ...(input.parentId === undefined
                ? {}
                : { parentId: input.parentId }),
            }
          : {
              workerId,
              leaseDurationSeconds: input.leaseDurationSeconds,
              workItemId: input.workItemId,
            };
      const result = await resolveClient(ctx).claim(body);
      return input.fullPrContext
        ? result
        : { ...result, context: compactPullRequestsInContext(result.context) };
    }),
  show: command
    .meta({ description: "Show a ticket" })
    .input(
      z.object({
        workItemId: positional(
          zGetWorkItemPath.shape.workItemId,
          "Ticket ID",
        ),
      }),
    )
    .query(({ ctx, input }) => resolveClient(ctx).getWorkItem(input.workItemId)),
  note: command
    .meta({ description: "Record progress or handoff notes on claimed work" })
    .input(noteInput)
    .mutation(async ({ ctx, input }) => {
      const client = resolveClient(ctx);
      const fence = await resolveLeaseFence(
        client,
        input.workItemId,
        workerIdentity(ctx.environment),
        input.leaseId,
        input.epoch,
      );
      return client.createNote(
        input.workItemId,
        {
          id: input.id ?? mutationUuid(ctx, input.idempotencyKey, "note"),
          ...fence,
          content: input.content,
        },
        input.idempotencyKey,
      );
    }),
  comment: command
    .meta({ description: "Append a note to released work" })
    .input(commentInput)
    .mutation(({ ctx, input }) => {
      const author = input.author ?? workerIdentity(ctx.environment);
      if (!author) {
        throw usageError(
          "Set WORK_GRAPH_WORKER_ID or pass --author for provenance.",
        );
      }
      return resolveClient(ctx).createPostReleaseNote(
        input.workItemId,
        {
          id:
            input.id ??
            mutationUuid(ctx, input.idempotencyKey, "post-release-note"),
          author,
          content: input.content,
        },
        input.idempotencyKey,
      );
    }),
  renew: command
    .meta({ description: "Renew a lease" })
    .input(renewInput)
    .mutation(({ ctx, input }) =>
      resolveClient(ctx).renew(input.leaseId, {
        epoch: input.epoch,
        leaseDurationSeconds: input.leaseDurationSeconds,
      }),
    ),
  touch: command
    .meta({ description: "Renew a ticket's active lease" })
    .input(
      z.object({
        workItemId: positional(
          zGetWorkItemPath.shape.workItemId,
          "Ticket ID",
        ),
        leaseDurationSeconds: leaseDuration,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = resolveClient(ctx);
      const fence = await resolveLeaseFence(
        client,
        input.workItemId,
        workerIdentity(ctx.environment),
        undefined,
        undefined,
      );
      return client.renew(fence.leaseId, {
        epoch: fence.epoch,
        leaseDurationSeconds: input.leaseDurationSeconds,
      });
    }),
  decompose: command
    .meta({ description: "Decompose a ticket into children" })
    .input(decomposeInput)
    .mutation(async ({ ctx, input }) => {
      const client = resolveClient(ctx);
      const fence = await resolveLeaseFence(
        client,
        input.workItemId,
        workerIdentity(ctx.environment),
        input.leaseId,
        input.epoch,
      );
      return client.decompose(
        input.workItemId,
        {
          ...fence,
          children: input.childrenJson,
          ...(input.dependenciesJson === undefined
            ? {}
            : { dependencies: input.dependenciesJson }),
          ...(input.claimWorkItemId === undefined
            ? {}
            : {
                claim: {
                  workItemId: input.claimWorkItemId,
                  leaseId:
                    input.claimLeaseId ??
                    mutationUuid(
                      ctx,
                      input.idempotencyKey,
                      "decomposition-claim",
                    ),
                  leaseDurationSeconds:
                    input.claimLeaseDurationSeconds ?? 900,
                },
              }),
        },
        input.idempotencyKey,
      );
    }),
  attention: t.router({
    list: command
      .meta({ description: "List attention requests" })
      .input(attentionListInput)
      .query(({ ctx, input }) =>
        resolveClient(ctx).listAttention({
          state: input.state ?? "unresolved",
          ...(input.blocking === undefined
            ? {}
            : { blocking: input.blocking }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
    request: command
      .meta({ description: "Request human or agent attention" })
      .input(attentionRequestInput)
      .mutation(async ({ ctx, input }) => {
        const client = resolveClient(ctx);
        const fence = await resolveLeaseFence(
          client,
          input.workItemId,
          workerIdentity(ctx.environment),
          input.leaseId,
          input.epoch,
        );
        return client.requestAttention(
          {
            id:
              input.id ??
              mutationUuid(ctx, input.idempotencyKey, "attention-request"),
            workItemId: input.workItemId,
            ...fence,
            kind: input.kind,
            question: input.question,
            ...(input.note === undefined ? {} : { note: input.note }),
            blocking: input.nonBlocking !== true,
          },
          input.idempotencyKey,
        );
      }),
    resolve: command
      .meta({ description: "Resolve an attention request" })
      .input(attentionResolveInput)
      .mutation(({ ctx, input }) =>
        resolveClient(ctx).resolveAttention(
          input.attentionRequestId,
          {
            id:
              input.id ??
              mutationUuid(ctx, input.idempotencyKey, "attention-resolution"),
            resolution: input.resolution,
          },
          input.idempotencyKey,
        ),
      ),
  }),
  release: command
    .meta({
      description: "Complete claimed work after it is merged and deployed",
    })
    .input(releaseInput)
    .mutation(async ({ ctx, input }) => {
      const client = resolveClient(ctx);
      const fence = await resolveLeaseFence(
        client,
        input.workItemId,
        workerIdentity(ctx.environment),
        input.leaseId,
        input.epoch,
      );
      return client.release(input.workItemId, {
        ...fence,
        mergeEvidence: input.mergeEvidence,
        deploymentEvidence: input.deploymentEvidence,
      });
    }),
  cancel: command
    .meta({ description: "Cancel claimed work" })
    .input(terminationInput)
    .mutation(async ({ ctx, input }) => {
      const client = resolveClient(ctx);
      const fence = await resolveLeaseFence(
        client,
        input.workItemId,
        workerIdentity(ctx.environment),
        input.leaseId,
        input.epoch,
      );
      return client.cancel(input.workItemId, fence);
    }),
});

export const createCommandContext = (
  context: Partial<CommandContext> = {},
): CommandContext => {
  const environment = context.environment ?? process.env;
  return {
    environment,
    fetch: context.fetch,
    inspectPullRequest:
      context.inspectPullRequest ??
      ((url) => inspectGitHubPullRequest(url, { environment })),
    makeUuid: context.makeUuid ?? randomUUID,
    selfUpdate: context.selfUpdate ?? updateFromCheckout,
    workingDirectory: context.workingDirectory ?? process.cwd(),
  };
};
