import {
  createRoute,
  OpenAPIHono,
  type Hook,
} from "@hono/zod-openapi";
import type { Env } from "hono";
import type {
  AttentionRequestReadModel,
  ArchiveKnowledgeScopeInput,
  ClaimWorkItemInput,
  CreateAttentionRequestInput,
  CreateAttentionRequestResult,
  CreateNoteInput,
  CreatePostReleaseNoteInput,
  DecomposeClaimedWorkItemInput,
  DecomposeClaimedWorkItemResult,
  IdempotentMutationOptions,
  KnowledgeScopeRelationshipCursor,
  ListAttentionRequestsInput,
  ListEventsInput,
  ListKnowledgeScopeRelationshipsInput,
  ListKnowledgeScopesInput,
  ListWorkItemsInput,
  ListWorkItemDependenciesInput,
  ListWorkItemLeasesInput,
  ListWorkItemNotesInput,
  PriorityMoveInput,
  ProjectCriticalPathInput,
  ResolveAttentionRequestInput,
  ResolveAttentionRequestResult,
  RenewLeaseInput,
  StoredAttentionRequest,
  StoredAttentionResolution,
  StoredEvent,
  StoredLease,
  StoredNote,
  TerminateClaimedWorkItemInput,
  WorkItemDependencyCursor,
  WorkItemReadModel,
  WorkItemSchedulingScopeInput,
} from "work-graph-db";
import { WORK_GRAPH_EVENT_TYPES } from "work-graph-db";
import {
  ARCHITECTURE_DECISION_ROLES,
  KNOWLEDGE_SCOPE_KINDS,
  KNOWLEDGE_SCOPE_LIFECYCLES,
  LEASE_OUTCOMES,
  MAX_CRITICAL_PATH_BLOCKING_PATHS,
  PULL_REQUEST_CHECK_SUMMARIES,
  PULL_REQUEST_MERGEABILITIES,
  PULL_REQUEST_REVIEW_DECISIONS,
  PULL_REQUEST_ROLES,
  PULL_REQUEST_STATES,
  WORK_ITEM_LIFECYCLES,
  WORK_ITEM_CONTEXT_KINDS,
  WORK_STAGES,
  WorkGraphError,
  type CriticalPathProjection,
  type KnowledgeScope,
  type KnowledgeScopeInput,
  type KnowledgeScopeRelationship,
  type NewWorkItemInput,
  type PullRequestSnapshot,
  type ResolvedWorkItemContext,
  type WorkItem,
  type WorkItemArchitectureDecision,
  type WorkItemContext,
  type WorkItemDependency,
  type WorkItemReference,
  type WorkItemPullRequest,
} from "work-graph-domain";
import { z } from "zod";

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TITLE_LENGTH = 10_000;
const MAX_LEASE_DURATION_SECONDS = 86_400;
const MAX_DECOMPOSITION_CHILDREN = 100;
const MAX_DECOMPOSITION_DEPENDENCIES = 1_000;
const DEFAULT_LIST_LIMIT = 50;
const MAX_URL_LENGTH = 2_048;
const MAX_RELATIONSHIP_CURSOR_LENGTH = 4_096;
const MAX_METADATA_CURSOR_LENGTH = 4_096;
const MAX_INT32 = 2_147_483_647;
const MAX_CRITICAL_PATH_NODES = 1_000;
const MAX_CRITICAL_PATH_EDGES = 5_000;
const WORK_ITEM_EVENT_TYPES = [
  "attention.requested",
  "attention.resolved",
  "dependency.added",
  "dependency.removed",
  "context.put",
  "lease.claimed",
  "lease.ended",
  "lease.renewed",
  "note.created",
  "pull_request.linked",
  "reference.put",
  "work_item.created",
  "work_item.decomposed",
  "work_item.expedited",
  "work_item.priority_moved",
  "work_item.lifecycle_changed",
  "work_item.reparented",
  "work_item.scheduling_scope_changed",
  "work_item.unexpedited",
] as const satisfies readonly (typeof WORK_GRAPH_EVENT_TYPES)[number][];
const workItemEventTypes = new Set<string>(WORK_ITEM_EVENT_TYPES);
const CREDENTIAL_FREE_HTTP_URL_PATTERN =
  /^[hH][tT][tT][pP][sS]?:\/\/(?![^/?#]*@)/;

const identifierSchema = z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH);
const leaseIdSchema = z.uuid().max(36);
const leaseEpochSchema = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647)
  .openapi({ format: "int32" });
const leaseDurationSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LEASE_DURATION_SECONDS)
  .openapi({ format: "int32" });
const childRankSchema = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647)
  .openapi({ format: "int32" });
const timestampSchema = z.iso.datetime().max(30);
const idempotencyHeadersSchema = z.object({
  "idempotency-key": z.uuid().max(36).optional().openapi({
    description:
      "Client-generated mutation ID. Reusing it with the same request replays the committed effect. Reusing it for different input returns a conflict.",
  }),
});

const errorSchema = z
  .object({
    error: z.object({
      code: z.string().min(1).max(100),
      message: z.string().min(1).max(500),
      details: z
        .array(
          z.object({
            path: z.array(z.union([z.string().max(200), z.number()])).max(20),
            message: z.string().max(500),
          }),
        )
        .max(100)
        .optional(),
    }),
  })
  .openapi("Error");

const leaseSchema = z
  .object({
    id: leaseIdSchema,
    workItemId: identifierSchema,
    workerId: identifierSchema,
    epoch: leaseEpochSchema,
    acquiredAt: timestampSchema,
    expiresAt: timestampSchema,
    endedAt: z.union([timestampSchema, z.null()]),
    outcome: z.union([z.enum(LEASE_OUTCOMES), z.null()]),
  })
  .openapi("Lease");

const storedWorkItemSchema = z
  .object({
    id: identifierSchema,
    title: z.string().min(1).max(MAX_TITLE_LENGTH),
    lifecycle: z.enum(WORK_ITEM_LIFECYCLES),
    parentId: z.union([identifierSchema, z.null()]),
    rank: z.union([childRankSchema, z.null()]),
    priorityRank: z.union([childRankSchema, z.null()]),
    schedulingInitiativeId: z.union([identifierSchema, z.null()]),
    schedulingProjectId: z.union([identifierSchema, z.null()]),
    expedited: z.boolean(),
    expediteReason: z.union([
      z.string().trim().min(1).max(MAX_TITLE_LENGTH),
      z.null(),
    ]),
  })
  .openapi("StoredWorkItem");
const workItemPrioritySchema = z
  .object({
    initiativeRank: childRankSchema,
    projectRank: childRankSchema,
    ticketRank: childRankSchema,
    expedited: z.boolean(),
    effectiveExpedited: z.boolean(),
    donatedFromWorkItemId: z.union([identifierSchema, z.null()]),
  })
  .openapi("WorkItemPriority");
const workItemSchema = storedWorkItemSchema
  .extend({
    priority: workItemPrioritySchema,
    stage: z.enum(WORK_STAGES),
    currentLease: z.union([leaseSchema, z.null()]),
  })
  .openapi("WorkItem");

const workItemListSchema = z
  .object({
    items: z.array(workItemSchema).max(100),
    nextCursor: z.union([identifierSchema, z.null()]),
  })
  .openapi("WorkItemList");
const criticalPathInclusionReasonSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("target_outcome") }),
    z.object({
      kind: z.literal("decomposition_child"),
      fromWorkItemId: identifierSchema,
    }),
    z.object({
      kind: z.literal("dependency_blocker"),
      fromWorkItemId: identifierSchema,
      dependencyDeclaredByWorkItemId: identifierSchema,
    }),
  ])
  .openapi("CriticalPathInclusionReason");
const criticalPathNodeSchema = z
  .object({
    item: storedWorkItemSchema,
    stage: z.enum(WORK_STAGES),
    claimable: z.boolean(),
    priority: workItemPrioritySchema,
    inclusionReasons: z
      .array(criticalPathInclusionReasonSchema)
      .min(1)
      .max(MAX_CRITICAL_PATH_EDGES + 1),
  })
  .openapi("CriticalPathNode");
const criticalPathEdgeSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("decomposition"),
      fromWorkItemId: identifierSchema,
      toWorkItemId: identifierSchema,
    }),
    z.object({
      kind: z.literal("dependency"),
      fromWorkItemId: identifierSchema,
      toWorkItemId: identifierSchema,
      dependencyDeclaredByWorkItemId: identifierSchema,
    }),
  ])
  .openapi("CriticalPathEdge");
const criticalPathPathSchema = z
  .array(identifierSchema)
  .min(1)
  .max(MAX_CRITICAL_PATH_NODES)
  .openapi("CriticalPathWorkItemPath");
const criticalPathParallelBranchSchema = z
  .object({
    workItemId: identifierSchema,
    stage: z.enum(WORK_STAGES),
    claimable: z.boolean(),
    targetWorkItemIds: z
      .array(identifierSchema)
      .max(MAX_CRITICAL_PATH_NODES),
    paths: z
      .array(criticalPathPathSchema)
      .max(MAX_CRITICAL_PATH_BLOCKING_PATHS),
  })
  .openapi("CriticalPathParallelBranch");
const criticalPathProjectionSchema = z
  .object({
    targetOutcomeIds: z.array(identifierSchema).max(MAX_CRITICAL_PATH_NODES),
    nodes: z.array(criticalPathNodeSchema).max(MAX_CRITICAL_PATH_NODES),
    edges: z.array(criticalPathEdgeSchema).max(MAX_CRITICAL_PATH_EDGES),
    blockingPaths: z
      .array(criticalPathPathSchema)
      .max(MAX_CRITICAL_PATH_BLOCKING_PATHS),
    readyLeafIds: z.array(identifierSchema).max(MAX_CRITICAL_PATH_NODES),
    blockingAttentionIds: z
      .array(identifierSchema)
      .max(MAX_CRITICAL_PATH_NODES),
    parallelBranches: z
      .array(criticalPathParallelBranchSchema)
      .max(MAX_CRITICAL_PATH_NODES),
  })
  .openapi("CriticalPathProjection");
const knowledgeScopeUrlSchema = z
  .url()
  .max(MAX_URL_LENGTH)
  .regex(CREDENTIAL_FREE_HTTP_URL_PATTERN)
  .openapi({ format: "uri" });
const knowledgeScopeSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(KNOWLEDGE_SCOPE_KINDS),
    title: z.string().min(1).max(MAX_TITLE_LENGTH),
    canonicalUrl: knowledgeScopeUrlSchema,
    markdownUrl: knowledgeScopeUrlSchema,
    sourceRevision: z.union([identifierSchema, z.null()]),
    lifecycle: z.enum(KNOWLEDGE_SCOPE_LIFECYCLES),
    archiveReason: z.union([
      z.string().min(1).max(MAX_TITLE_LENGTH),
      z.null(),
    ]),
    rank: z.union([childRankSchema, z.null()]),
  })
  .openapi("KnowledgeScope");
const contextUrlSchema = z
  .url()
  .max(MAX_URL_LENGTH)
  .regex(CREDENTIAL_FREE_HTTP_URL_PATTERN)
  .openapi({ format: "uri" });
const inheritanceDepthSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_INT32)
  .openapi({ format: "int32" });
const workItemTextContextSchema = z.object({
  workItemId: identifierSchema,
  kind: z.enum(WORK_ITEM_CONTEXT_KINDS),
  content: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
});
const workItemArchitectureDecisionSchema = z.object({
  workItemId: identifierSchema,
  kind: z.literal("architecture_decision"),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  url: contextUrlSchema,
  role: z.enum(ARCHITECTURE_DECISION_ROLES),
});
const pullRequestSnapshotSchema = z
  .object({
    repository: identifierSchema,
    number: z.number().int().min(1).max(MAX_INT32).openapi({ format: "int32" }),
    url: contextUrlSchema,
    headSha: z.string().max(40).regex(/^[0-9a-f]{40}$/),
    state: z.enum(PULL_REQUEST_STATES),
    draft: z.boolean(),
    mergeability: z.enum(PULL_REQUEST_MERGEABILITIES),
    reviewDecision: z.union([
      z.enum(PULL_REQUEST_REVIEW_DECISIONS),
      z.null(),
    ]),
    checkSummary: z.enum(PULL_REQUEST_CHECK_SUMMARIES),
    observedAt: timestampSchema,
  })
  .openapi("PullRequestSnapshot");
const resolvedPullRequestSchema = z
  .object({
    kind: z.literal("pull_request"),
    role: z.enum(PULL_REQUEST_ROLES),
    pullRequest: pullRequestSnapshotSchema,
    sourceWorkItemId: identifierSchema,
    inheritanceDepth: inheritanceDepthSchema,
  })
  .openapi("ResolvedPullRequest");
const workItemContextRecordSchema = z
  .union([workItemTextContextSchema, workItemArchitectureDecisionSchema])
  .openapi("WorkItemContextRecord");
const resolvedWorkItemContextSchema = z
  .union([
    workItemTextContextSchema
      .omit({ workItemId: true })
      .extend({
        sourceWorkItemId: identifierSchema,
        inheritanceDepth: inheritanceDepthSchema,
      }),
    workItemArchitectureDecisionSchema
      .omit({ workItemId: true })
      .extend({
        sourceWorkItemId: identifierSchema,
        inheritanceDepth: inheritanceDepthSchema,
      }),
    z.object({
      kind: z.enum(["project", "initiative"]),
      scope: knowledgeScopeSchema,
      sourceWorkItemId: identifierSchema,
      inheritanceDepth: inheritanceDepthSchema,
    }),
    z.object({
      kind: z.literal("reference"),
      title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
      url: contextUrlSchema,
      sourceWorkItemId: identifierSchema,
      inheritanceDepth: inheritanceDepthSchema,
    }),
    resolvedPullRequestSchema,
  ])
  .openapi("ResolvedWorkItemContext");
const resolvedWorkItemContextListSchema = z
  .object({ items: z.array(resolvedWorkItemContextSchema).max(1_000) })
  .openapi("ResolvedWorkItemContextList");
const workItemReferenceSchema = z
  .object({
    workItemId: identifierSchema,
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    url: contextUrlSchema,
  })
  .openapi("WorkItemReference");
const workItemPullRequestSchema = z
  .object({
    workItemId: identifierSchema,
    repository: identifierSchema,
    number: z.number().int().min(1).max(MAX_INT32).openapi({ format: "int32" }),
    role: z.enum(PULL_REQUEST_ROLES),
  })
  .openapi("WorkItemPullRequest");
const resolvedPullRequestListSchema = z
  .object({ items: z.array(resolvedPullRequestSchema).max(1_000) })
  .openapi("ResolvedPullRequestList");
const knowledgeScopeListSchema = z
  .object({
    items: z.array(knowledgeScopeSchema).max(100),
    nextCursor: z.union([identifierSchema, z.null()]),
  })
  .openapi("KnowledgeScopeList");
const knowledgeScopeRelationshipSchema = z
  .object({
    parentKnowledgeScopeId: identifierSchema,
    childKnowledgeScopeId: identifierSchema,
  })
  .openapi("KnowledgeScopeRelationship");
const knowledgeScopeRelationshipListSchema = z
  .object({
    items: z.array(knowledgeScopeRelationshipSchema).max(100),
    nextCursor: z.union([
      z.string().min(1).max(MAX_RELATIONSHIP_CURSOR_LENGTH),
      z.null(),
    ]),
  })
  .openapi("KnowledgeScopeRelationshipList");
const workItemDependencySchema = z
  .object({
    dependentWorkItemId: identifierSchema,
    blockerWorkItemId: identifierSchema,
  })
  .openapi("WorkItemDependency");
const noteSchema = z
  .object({
    id: z.uuid().max(36),
    workItemId: identifierSchema,
    kind: z.enum(["work", "post_release"]),
    leaseId: z.union([leaseIdSchema, z.null()]),
    author: identifierSchema,
    content: z.string().min(1).max(MAX_TITLE_LENGTH),
    createdAt: timestampSchema,
  })
  .openapi("WorkItemNote");
const noteListSchema = z
  .object({
    items: z.array(noteSchema).max(100),
    nextCursor: z.union([z.uuid().max(36), z.null()]),
  })
  .openapi("WorkItemNoteList");
const eventSchema = z
  .object({
    sequence: z
      .number()
      .int()
      .min(1)
      .max(MAX_INT32)
      .openapi({ format: "int32" }),
    type: z.enum(WORK_ITEM_EVENT_TYPES),
    workItemId: z.union([identifierSchema, z.null()]),
    data: z.record(z.string(), z.unknown()),
    occurredAt: timestampSchema,
  })
  .openapi("WorkItemEvent");
const eventListSchema = z
  .object({
    items: z.array(eventSchema).max(100),
    nextCursor: z.union([
      z.number().int().min(1).max(MAX_INT32).openapi({ format: "int32" }),
      z.null(),
    ]),
  })
  .openapi("WorkItemEventList");
const dependencyListSchema = z
  .object({
    items: z.array(workItemDependencySchema).max(100),
    nextCursor: z.union([
      z.string().min(1).max(MAX_METADATA_CURSOR_LENGTH),
      z.null(),
    ]),
  })
  .openapi("WorkItemDependencyList");
const leaseListSchema = z
  .object({
    items: z.array(leaseSchema).max(100),
    nextCursor: z.union([
      z.number().int().min(1).max(MAX_INT32).openapi({ format: "int32" }),
      z.null(),
    ]),
  })
  .openapi("WorkItemLeaseList");
const attentionRequestSchema = z
  .object({
    id: z.uuid().max(36),
    workItemId: identifierSchema,
    requestingLeaseId: leaseIdSchema,
    kind: z.string().min(1).max(100),
    question: z.string().min(1).max(MAX_TITLE_LENGTH),
    note: z.union([
      z.string().min(1).max(MAX_TITLE_LENGTH),
      z.null(),
    ]),
    blocking: z.boolean(),
    createdAt: timestampSchema,
  })
  .openapi("AttentionRequest");
const attentionResolutionSchema = z
  .object({
    id: z.uuid().max(36),
    attentionRequestId: z.uuid().max(36),
    resolution: z.string().min(1).max(MAX_TITLE_LENGTH),
    createdAt: timestampSchema,
  })
  .openapi("AttentionResolution");
const attentionRequestReadSchema = attentionRequestSchema
  .extend({ resolution: z.union([attentionResolutionSchema, z.null()]) })
  .openapi("AttentionRequestReadModel");
const attentionRequestListSchema = z
  .object({
    items: z.array(attentionRequestReadSchema).max(100),
    nextCursor: z.union([z.uuid().max(36), z.null()]),
  })
  .openapi("AttentionRequestList");
const attentionRequestResponseSchema = z
  .object({
    attentionRequest: attentionRequestSchema,
    endedLease: z.union([leaseSchema, z.null()]),
    workItem: workItemSchema,
  })
  .openapi("AttentionRequestResponse");
const attentionResolutionResponseSchema = z
  .object({
    resolution: attentionResolutionSchema,
    workItem: workItemSchema,
  })
  .openapi("AttentionResolutionResponse");
const leaseWithWorkItemSchema = z
  .object({ lease: leaseSchema, workItem: workItemSchema })
  .openapi("LeaseWithWorkItem");
const claimResponseSchema = leaseWithWorkItemSchema
  .extend({ context: z.array(resolvedWorkItemContextSchema).max(1_000) })
  .openapi("ClaimResponse");
const leaseResponseSchema = z
  .object({ lease: leaseSchema })
  .openapi("LeaseResponse");

const listWorkItemsQuerySchema = z.object({
  stage: z.enum(WORK_STAGES).optional(),
  initiativeId: identifierSchema.optional(),
  projectId: identifierSchema.optional(),
  parentId: identifierSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_LIST_LIMIT)
    .openapi({ format: "int32" }),
  cursor: identifierSchema.optional(),
});
const getCriticalPathQuerySchema = z
  .object({
    initiativeId: identifierSchema.optional(),
    projectId: identifierSchema.optional(),
    rootWorkItemId: identifierSchema.optional(),
  })
  .refine(
    ({ initiativeId, projectId, rootWorkItemId }) =>
      rootWorkItemId === undefined ||
      (initiativeId === undefined && projectId === undefined),
    {
      message:
        "rootWorkItemId cannot be combined with initiativeId or projectId",
      path: ["rootWorkItemId"],
    },
  );
const listAttentionRequestsQuerySchema = z.object({
  workItemId: identifierSchema.optional(),
  state: z.enum(["all", "unresolved", "resolved"]).default("unresolved"),
  blocking: z.enum(["true", "false"]).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_LIST_LIMIT)
    .openapi({ format: "int32" }),
  cursor: z.uuid().max(36).optional(),
});
const metadataPageLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(DEFAULT_LIST_LIMIT)
  .openapi({ format: "int32" });
const listWorkItemNotesQuerySchema = z.object({
  limit: metadataPageLimitSchema,
  cursor: z.uuid().max(36).optional(),
});
const listWorkItemEventsQuerySchema = z
  .object({
    type: z.enum(WORK_ITEM_EVENT_TYPES).optional(),
    lifecycle: z.enum(["released", "cancelled"]).optional(),
    limit: metadataPageLimitSchema,
    afterSequence: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_INT32)
      .openapi({ format: "int32" })
      .optional(),
  })
  .refine(
    ({ lifecycle, type }) =>
      lifecycle === undefined || type === "work_item.lifecycle_changed",
    {
      message:
        "lifecycle requires type work_item.lifecycle_changed",
      path: ["lifecycle"],
    },
  );
const listWorkItemDependenciesQuerySchema = z.object({
  limit: metadataPageLimitSchema,
  cursor: z.string().min(1).max(MAX_METADATA_CURSOR_LENGTH).optional(),
});
const listWorkItemLeasesQuerySchema = z.object({
  limit: metadataPageLimitSchema,
  afterEpoch: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_INT32)
    .openapi({ format: "int32" })
    .optional(),
});
const listKnowledgeScopesQuerySchema = z.object({
  kind: z.enum(KNOWLEDGE_SCOPE_KINDS).optional(),
  includeArchived: z.enum(["true"]).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_LIST_LIMIT)
    .openapi({ format: "int32" }),
  cursor: identifierSchema.optional(),
});
const listKnowledgeScopeRelationshipsQuerySchema = z.object({
  includeArchived: z.enum(["true"]).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_LIST_LIMIT)
    .openapi({ format: "int32" }),
  cursor: z
    .string()
    .min(1)
    .max(MAX_RELATIONSHIP_CURSOR_LENGTH)
    .optional(),
});
const workItemParamsSchema = z.object({ workItemId: identifierSchema });
const knowledgeScopeParamsSchema = z.object({
  knowledgeScopeId: identifierSchema,
});
const leaseParamsSchema = z.object({ leaseId: leaseIdSchema });
const attentionRequestParamsSchema = z.object({
  attentionRequestId: z.uuid().max(36),
});
const createWorkItemBodySchema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    parentId: z.union([identifierSchema, z.null()]).optional(),
    schedulingInitiativeId: z
      .union([identifierSchema, z.null()])
      .optional(),
    schedulingProjectId: z.union([identifierSchema, z.null()]).optional(),
  })
  .strict();
const putWorkItemContextBodySchema = z.union([
  workItemTextContextSchema.omit({ workItemId: true }).strict(),
  workItemArchitectureDecisionSchema.omit({ workItemId: true }).strict(),
]);
const putWorkItemReferenceBodySchema = workItemReferenceSchema
  .omit({ workItemId: true })
  .strict();
const refreshPullRequestBodySchema = pullRequestSnapshotSchema.strict();
const putWorkItemPullRequestBodySchema = workItemPullRequestSchema
  .omit({ workItemId: true })
  .strict();
const putKnowledgeScopeBodySchema = knowledgeScopeSchema
  .omit({
    id: true,
    lifecycle: true,
    archiveReason: true,
    rank: true,
  })
  .extend({
    sourceRevision: z.union([identifierSchema, z.null()]).optional(),
  })
  .strict();
const archiveKnowledgeScopeBodySchema = z
  .object({
    reason: z.string().min(1).max(MAX_TITLE_LENGTH),
  })
  .strict();
const priorityMoveBodySchema = z.union([
  z
    .object({
      higherThanId: identifierSchema,
      lowerThanId: identifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      higherThanId: identifierSchema.optional(),
      lowerThanId: identifierSchema,
    })
    .strict(),
]);
const expediteWorkItemBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  })
  .strict();
const knowledgeScopeRelationshipBodySchema =
  knowledgeScopeRelationshipSchema.strict();
const dependencyBodySchema = workItemDependencySchema.strict();
const createNoteBodySchema = z
  .object({
    id: z.uuid().max(36),
    leaseId: leaseIdSchema,
    epoch: leaseEpochSchema,
    content: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  })
  .strict();
const createPostReleaseNoteBodySchema = z
  .object({
    id: z.uuid().max(36),
    author: identifierSchema,
    content: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  })
  .strict();
const createAttentionRequestBodySchema = z
  .object({
    id: z.uuid().max(36),
    workItemId: identifierSchema,
    leaseId: leaseIdSchema,
    epoch: leaseEpochSchema,
    kind: z.string().trim().min(1).max(100),
    question: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    note: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
    blocking: z.boolean().default(true),
  })
  .strict();
const resolveAttentionRequestBodySchema = z
  .object({
    id: z.uuid().max(36),
    resolution: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  })
  .strict();
const createLeaseBodySchema = z.union([
  z
    .object({
      workerId: identifierSchema,
      leaseDurationSeconds: leaseDurationSchema,
      workItemId: identifierSchema,
    })
    .strict(),
  z
    .object({
      workerId: identifierSchema,
      leaseDurationSeconds: leaseDurationSchema,
      initiativeId: identifierSchema.optional(),
      projectId: identifierSchema.optional(),
      parentId: identifierSchema.optional(),
    })
    .strict(),
]);
const putWorkItemSchedulingScopeBodySchema = z
  .object({
    schedulingInitiativeId: z.union([identifierSchema, z.null()]),
    schedulingProjectId: z.union([identifierSchema, z.null()]),
  })
  .strict();
const putWorkItemParentBodySchema = z
  .object({ parentId: z.union([identifierSchema, z.null()]) })
  .strict();
const renewLeaseBodySchema = z
  .object({
    epoch: leaseEpochSchema,
    leaseDurationSeconds: leaseDurationSchema,
  })
  .strict();
const terminateWorkItemBodySchema = z
  .object({ leaseId: leaseIdSchema, epoch: leaseEpochSchema })
  .strict();
const releaseWorkItemBodySchema = terminateWorkItemBodySchema
  .extend({
    mergeEvidence: z
      .string()
      .trim()
      .min(1)
      .max(MAX_TITLE_LENGTH)
      .regex(/\S/),
    deploymentEvidence: z
      .string()
      .trim()
      .min(1)
      .max(MAX_TITLE_LENGTH)
      .regex(/\S/),
  })
  .strict();
const decompositionChildSchema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    rank: childRankSchema,
  })
  .strict();
const decompositionClaimSchema = z
  .object({
    workItemId: identifierSchema,
    leaseId: leaseIdSchema,
    leaseDurationSeconds: leaseDurationSchema,
  })
  .strict();
const createDecompositionBodySchema = z
  .object({
    leaseId: leaseIdSchema,
    epoch: leaseEpochSchema,
    children: z
      .array(decompositionChildSchema)
      .min(1)
      .max(MAX_DECOMPOSITION_CHILDREN),
    dependencies: z
      .array(dependencyBodySchema)
      .max(MAX_DECOMPOSITION_DEPENDENCIES)
      .optional(),
    claim: decompositionClaimSchema.optional(),
  })
  .strict();

const decompositionResponseSchema = z
  .object({
    parent: workItemSchema,
    children: z
      .array(
        z.object({
          rank: childRankSchema,
          workItem: workItemSchema,
        }),
      )
      .max(MAX_DECOMPOSITION_CHILDREN),
    dependencies: z
      .array(workItemDependencySchema)
      .max(MAX_DECOMPOSITION_DEPENDENCIES),
    endedLease: leaseSchema,
    claimedLease: z.union([leaseSchema, z.null()]),
  })
  .openapi("WorkItemDecomposition");

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const standardErrors = {
  400: errorResponse("Invalid request"),
  401: errorResponse("Cloudflare Access authentication required"),
  403: errorResponse("Cloudflare Access denied the request"),
  404: errorResponse("Resource not found"),
  409: errorResponse("Request conflicts with current Work Graph state"),
  422: errorResponse("Request validation failed"),
  500: errorResponse("Unexpected server error"),
};
const accessSecurity = [
  { cloudflareAccessClientId: [], cloudflareAccessClientSecret: [] },
];

const listWorkItemsRoute = createRoute({
  method: "get",
  path: "/api/work-items",
  operationId: "listWorkItems",
  summary: "List work items with their derived stage",
  description:
    "Returns one bounded page in global priority order. Optional stage, initiative, project, and direct-parent filters preserve that relative order. Pass nextCursor to continue after the last observed item without offset drift during lease transitions.",
  tags: ["work-items"],
  security: accessSecurity,
  request: { query: listWorkItemsQuerySchema },
  responses: {
    200: {
      description: "Work items in deterministic priority order",
      content: { "application/json": { schema: workItemListSchema } },
    },
    ...standardErrors,
  },
});

const getCriticalPathRoute = createRoute({
  method: "get",
  path: "/api/critical-path",
  operationId: "getCriticalPath",
  summary: "Project the current delivery-critical path",
  description:
    "Returns one deterministic, bounded projection for global open roots, an initiative, a project, or one explicit root work item. Initiative and project filters may be combined. An explicit root cannot be combined with scope filters. Projections are limited to 1,000 nodes, 5,000 edges, and 5,000 blocking paths; larger projections return a conflict instead of a partial graph.",
  tags: ["work-items"],
  security: accessSecurity,
  request: { query: getCriticalPathQuerySchema },
  responses: {
    200: {
      description:
        "Critical-path targets, included nodes and edges, blocking paths, and claimable parallel branches",
      content: {
        "application/json": { schema: criticalPathProjectionSchema },
      },
    },
    ...standardErrors,
  },
});

const listKnowledgeScopesRoute = createRoute({
  method: "get",
  path: "/api/knowledge-scopes",
  operationId: "listKnowledgeScopes",
  summary: "List knowledge-scope mirrors",
  description:
    "Returns active initiative and project mirrors in stable source-key order. The optional kind filter does not change that order. Set includeArchived=true for an audit view.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: { query: listKnowledgeScopesQuerySchema },
  responses: {
    200: {
      description: "Knowledge scopes in stable source-key order",
      content: { "application/json": { schema: knowledgeScopeListSchema } },
    },
    ...standardErrors,
  },
});

const getKnowledgeScopeRoute = createRoute({
  method: "get",
  path: "/api/knowledge-scopes/{knowledgeScopeId}",
  operationId: "getKnowledgeScope",
  summary: "Read a knowledge-scope mirror",
  description:
    "Returns the current source snapshot and scheduling fields for one stable source key.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: { params: knowledgeScopeParamsSchema },
  responses: {
    200: {
      description: "Current knowledge-scope mirror",
      content: { "application/json": { schema: knowledgeScopeSchema } },
    },
    ...standardErrors,
  },
});

const putKnowledgeScopeRoute = createRoute({
  method: "put",
  path: "/api/knowledge-scopes/{knowledgeScopeId}",
  operationId: "putKnowledgeScope",
  summary: "Create or replace a knowledge-scope mirror",
  description:
    "Uses the stable public source key as the resource ID. Replacing a mirror updates its source snapshot without changing relationship identity.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: {
    params: knowledgeScopeParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: putKnowledgeScopeBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Knowledge scope created, replaced, or replayed",
      content: { "application/json": { schema: knowledgeScopeSchema } },
    },
    ...standardErrors,
  },
});

const archiveKnowledgeScopeRoute = createRoute({
  method: "post",
  path: "/api/knowledge-scopes/{knowledgeScopeId}/archival",
  operationId: "archiveKnowledgeScope",
  summary: "Archive a knowledge-scope mirror",
  description:
    "Removes a scope from active scheduling and priority order while retaining its source snapshot, relationships, and historical work-item context. Open work must move or terminate first.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: {
    params: knowledgeScopeParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: archiveKnowledgeScopeBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Knowledge scope archived or matching mutation replayed",
      content: { "application/json": { schema: knowledgeScopeSchema } },
    },
    ...standardErrors,
  },
});

const restoreKnowledgeScopeRoute = createRoute({
  method: "delete",
  path: "/api/knowledge-scopes/{knowledgeScopeId}/archival",
  operationId: "restoreKnowledgeScope",
  summary: "Restore an archived knowledge-scope mirror",
  description:
    "Returns an archived scope to active scheduling at the median position for its kind.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: {
    params: knowledgeScopeParamsSchema,
    headers: idempotencyHeadersSchema,
  },
  responses: {
    200: {
      description: "Knowledge scope restored or matching mutation replayed",
      content: { "application/json": { schema: knowledgeScopeSchema } },
    },
    ...standardErrors,
  },
});

const moveKnowledgeScopePriorityRoute = createRoute({
  method: "post",
  path: "/api/knowledge-scopes/{knowledgeScopeId}/priority-moves",
  operationId: "moveKnowledgeScopePriority",
  summary: "Move a knowledge scope within its priority list",
  description:
    "Places an initiative among initiatives or a project among projects using relative anchors. The service owns numeric ranks.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: {
    params: knowledgeScopeParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: priorityMoveBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Knowledge scope moved or matching mutation replayed",
      content: { "application/json": { schema: knowledgeScopeSchema } },
    },
    ...standardErrors,
  },
});

const listKnowledgeScopeRelationshipsRoute = createRoute({
  method: "get",
  path: "/api/knowledge-scope-relationships",
  operationId: "listKnowledgeScopeRelationships",
  summary: "List knowledge-scope relationships",
  description:
    "Returns a bounded page of directed parent-to-child edges between active scopes in stable order. Set includeArchived=true for an audit view. Pass nextCursor unchanged to continue.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: { query: listKnowledgeScopeRelationshipsQuerySchema },
  responses: {
    200: {
      description: "Knowledge-scope relationships",
      content: {
        "application/json": { schema: knowledgeScopeRelationshipListSchema },
      },
    },
    ...standardErrors,
  },
});

const createKnowledgeScopeRelationshipRoute = createRoute({
  method: "post",
  path: "/api/knowledge-scope-relationships",
  operationId: "createKnowledgeScopeRelationship",
  summary: "Add a knowledge-scope relationship",
  description:
    "Adds one parent-to-child edge after rejecting missing scopes, duplicates, self-links, and cycles.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: {
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: knowledgeScopeRelationshipBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: "Knowledge-scope relationship added or replayed",
      content: {
        "application/json": { schema: knowledgeScopeRelationshipSchema },
      },
    },
    ...standardErrors,
  },
});

const deleteKnowledgeScopeRelationshipRoute = createRoute({
  method: "delete",
  path: "/api/knowledge-scope-relationships",
  operationId: "deleteKnowledgeScopeRelationship",
  summary: "Remove a knowledge-scope relationship",
  description:
    "Removes one parent-to-child edge without deleting either scope mirror.",
  tags: ["knowledge-scopes"],
  security: accessSecurity,
  request: {
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: knowledgeScopeRelationshipBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Knowledge-scope relationship removed or replayed",
      content: {
        "application/json": { schema: knowledgeScopeRelationshipSchema },
      },
    },
    ...standardErrors,
  },
});

const getWorkItemRoute = createRoute({
  method: "get",
  path: "/api/work-items/{workItemId}",
  operationId: "getWorkItem",
  summary: "Read a work item with its derived stage",
  description:
    "Returns stored lifecycle data together with the current derived operational stage and lease.",
  tags: ["work-items"],
  security: accessSecurity,
  request: { params: workItemParamsSchema },
  responses: {
    200: {
      description: "Current work-item projection",
      content: { "application/json": { schema: workItemSchema } },
    },
    ...standardErrors,
  },
});

const createWorkItemRoute = createRoute({
  method: "post",
  path: "/api/work-items",
  operationId: "createWorkItem",
  summary: "Create a sparse work item",
  description:
    "Creates an open work item from its identity and title, with an optional parent. Lifecycle and operational stage are not accepted because the service derives them from graph state.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: createWorkItemBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Work item created or matching mutation replayed",
      content: { "application/json": { schema: workItemSchema } },
    },
    ...standardErrors,
  },
});

const putWorkItemParentRoute = createRoute({
  method: "put",
  path: "/api/work-items/{workItemId}/parent",
  operationId: "putWorkItemParent",
  summary: "Replace or remove a work item's parent",
  description:
    "Reparents an existing work item without replacing its identity or attached history. A null parent detaches it to the graph root. The service rejects hierarchy, dependency, and combined waits-for cycles atomically.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: putWorkItemParentBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Work item reparented, detached, unchanged, or replayed",
      content: { "application/json": { schema: workItemSchema } },
    },
    ...standardErrors,
  },
});

const moveWorkItemPriorityRoute = createRoute({
  method: "post",
  path: "/api/work-items/{workItemId}/priority-moves",
  operationId: "moveWorkItemPriority",
  summary: "Move a ticket within its project priority list",
  description:
    "Places a priority-owning ticket relative to tickets in the same scheduling project. Decomposed children inherit their ticket's position.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: priorityMoveBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Ticket moved or matching mutation replayed",
      content: { "application/json": { schema: workItemSchema } },
    },
    ...standardErrors,
  },
});

const putWorkItemSchedulingScopeRoute = createRoute({
  method: "put",
  path: "/api/work-items/{workItemId}/scheduling-scope",
  operationId: "putWorkItemSchedulingScope",
  summary: "Set a root ticket's scheduling scope",
  description:
    "Assigns a priority-owning root ticket to an initiative and project. Descendants inherit the assignment. Null values move the ticket back to the unscoped queue.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: putWorkItemSchedulingScopeBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Scheduling scope assigned or matching mutation replayed",
      content: { "application/json": { schema: workItemSchema } },
    },
    ...standardErrors,
  },
});

const expediteWorkItemRoute = createRoute({
  method: "post",
  path: "/api/work-items/{workItemId}/expedites",
  operationId: "expediteWorkItem",
  summary: "Expedite a ticket",
  description:
    "Places a ticket ahead of normal fused priority and donates that urgency to unresolved blockers without permanently expediting them.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: expediteWorkItemBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Ticket expedited or matching mutation replayed",
      content: { "application/json": { schema: workItemSchema } },
    },
    ...standardErrors,
  },
});

const unexpediteWorkItemRoute = createRoute({
  method: "delete",
  path: "/api/work-items/{workItemId}/expedites",
  operationId: "unexpediteWorkItem",
  summary: "Remove a ticket expedite",
  description:
    "Returns a ticket to the fused normal queue and removes its donated urgency from unresolved blockers.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
  },
  responses: {
    200: {
      description: "Ticket expedite removed or matching mutation replayed",
      content: { "application/json": { schema: workItemSchema } },
    },
    ...standardErrors,
  },
});

const listWorkItemContextsRoute = createRoute({
  method: "get",
  path: "/api/work-items/{workItemId}/contexts",
  operationId: "listWorkItemContexts",
  summary: "Resolve context for a work item",
  description:
    "Returns the work item's own and inherited context in deterministic claim order, with source and inheritance depth retained.",
  tags: ["work-items"],
  security: accessSecurity,
  request: { params: workItemParamsSchema },
  responses: {
    200: {
      description: "Resolved context in claim order",
      content: {
        "application/json": { schema: resolvedWorkItemContextListSchema },
      },
    },
    ...standardErrors,
  },
});

const putWorkItemContextRoute = createRoute({
  method: "put",
  path: "/api/work-items/{workItemId}/contexts",
  operationId: "putWorkItemContext",
  summary: "Create or replace typed work-item context",
  description:
    "Upserts a brief or acceptance criteria by kind, or an architecture decision by URL. Context never changes scheduling eligibility.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: putWorkItemContextBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Context created, replaced, or replayed",
      content: { "application/json": { schema: workItemContextRecordSchema } },
    },
    ...standardErrors,
  },
});

const putWorkItemReferenceRoute = createRoute({
  method: "put",
  path: "/api/work-items/{workItemId}/references",
  operationId: "putWorkItemReference",
  summary: "Create or replace a supplemental reference",
  description:
    "Upserts a supplemental reference by URL. References provide worker context and never affect scheduling eligibility.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: putWorkItemReferenceBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Reference created, replaced, or replayed",
      content: { "application/json": { schema: workItemReferenceSchema } },
    },
    ...standardErrors,
  },
});

const refreshPullRequestRoute = createRoute({
  method: "put",
  path: "/api/pull-requests",
  operationId: "refreshPullRequest",
  summary: "Create or refresh a pull-request snapshot",
  description:
    "Upserts informational pull-request state by repository and number. This mutation is separate from claim transactions.",
  tags: ["pull-requests"],
  security: accessSecurity,
  request: {
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: refreshPullRequestBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Pull-request snapshot created, refreshed, or replayed",
      content: { "application/json": { schema: pullRequestSnapshotSchema } },
    },
    ...standardErrors,
  },
});

const listWorkItemPullRequestsRoute = createRoute({
  method: "get",
  path: "/api/work-items/{workItemId}/pull-requests",
  operationId: "listWorkItemPullRequests",
  summary: "List pull requests for a work item",
  description:
    "Returns direct and inherited pull-request links in claim-context order. Snapshot state is informational and does not affect scheduling.",
  tags: ["work-items", "pull-requests"],
  security: accessSecurity,
  request: { params: workItemParamsSchema },
  responses: {
    200: {
      description: "Resolved pull requests in claim-context order",
      content: { "application/json": { schema: resolvedPullRequestListSchema } },
    },
    ...standardErrors,
  },
});

const putWorkItemPullRequestRoute = createRoute({
  method: "put",
  path: "/api/work-items/{workItemId}/pull-requests",
  operationId: "putWorkItemPullRequest",
  summary: "Link a pull request to a work item",
  description:
    "Upserts a typed implementation, evidence, or related link to an existing pull-request snapshot. Links never create dependency edges.",
  tags: ["work-items", "pull-requests"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: putWorkItemPullRequestBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Pull-request link created, replaced, or replayed",
      content: { "application/json": { schema: workItemPullRequestSchema } },
    },
    ...standardErrors,
  },
});

const createDependencyRoute = createRoute({
  method: "post",
  path: "/api/dependencies",
  operationId: "createDependency",
  summary: "Add a work-item dependency",
  description:
    "Adds one explicit blocker edge after checking the serialized hierarchy and dependency waits-for graph for cycles.",
  tags: ["dependencies"],
  security: accessSecurity,
  request: {
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: dependencyBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Dependency added or matching mutation replayed",
      content: { "application/json": { schema: workItemDependencySchema } },
    },
    ...standardErrors,
  },
});

const deleteDependencyRoute = createRoute({
  method: "delete",
  path: "/api/dependencies",
  operationId: "deleteDependency",
  summary: "Remove a work-item dependency",
  description:
    "Removes one explicit blocker edge without changing hierarchy or work-item lifecycle.",
  tags: ["dependencies"],
  security: accessSecurity,
  request: {
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: dependencyBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Dependency removed or matching mutation replayed",
      content: { "application/json": { schema: workItemDependencySchema } },
    },
    ...standardErrors,
  },
});

const createNoteRoute = createRoute({
  method: "post",
  path: "/api/work-items/{workItemId}/notes",
  operationId: "createWorkItemNote",
  summary: "Record a note for claimed work",
  description:
    "Records a short or long note only when the supplied lease ID and epoch still own the named work item.",
  tags: ["notes"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: createNoteBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Note recorded or matching mutation replayed",
      content: { "application/json": { schema: noteSchema } },
    },
    ...standardErrors,
  },
});

const createPostReleaseNoteRoute = createRoute({
  method: "post",
  path: "/api/work-items/{workItemId}/comments",
  operationId: "createPostReleaseWorkItemNote",
  summary: "Append discussion to released work",
  description:
    "Appends an immutable, attributed note to a released work item without changing its lifecycle, release evidence, lease history, or timestamps. Cloudflare Access must authenticate the caller.",
  tags: ["notes"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: createPostReleaseNoteBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: "Post-release note appended or matching mutation replayed",
      content: { "application/json": { schema: noteSchema } },
    },
    ...standardErrors,
  },
});

const listWorkItemNotesRoute = createRoute({
  method: "get",
  path: "/api/work-items/{workItemId}/notes",
  operationId: "listWorkItemNotes",
  summary: "List notes for a work item",
  description:
    "Returns immutable lease-fenced work notes and append-only post-release discussion in stable note-ID order. Pass nextCursor to continue without offset drift.",
  tags: ["notes"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    query: listWorkItemNotesQuerySchema,
  },
  responses: {
    200: {
      description: "Work-item notes in stable order",
      content: { "application/json": { schema: noteListSchema } },
    },
    ...standardErrors,
  },
});

const listWorkItemEventsRoute = createRoute({
  method: "get",
  path: "/api/work-items/{workItemId}/events",
  operationId: "listWorkItemEvents",
  summary: "List immutable events for a work item",
  description:
    "Returns events in stable sequence order. Type and terminal-lifecycle filters expose decomposition, cancellation, and release history without separate mutable records.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    query: listWorkItemEventsQuerySchema,
  },
  responses: {
    200: {
      description: "Work-item events in stable sequence order",
      content: { "application/json": { schema: eventListSchema } },
    },
    ...standardErrors,
  },
});

const listWorkItemDependenciesRoute = createRoute({
  method: "get",
  path: "/api/work-items/{workItemId}/dependencies",
  operationId: "listWorkItemDependencies",
  summary: "List dependency edges involving a work item",
  description:
    "Returns current incoming and outgoing dependency edges in stable dependent-ID and blocker-ID order.",
  tags: ["dependencies"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    query: listWorkItemDependenciesQuerySchema,
  },
  responses: {
    200: {
      description: "Current dependency edges involving the work item",
      content: { "application/json": { schema: dependencyListSchema } },
    },
    ...standardErrors,
  },
});

const listWorkItemLeasesRoute = createRoute({
  method: "get",
  path: "/api/work-items/{workItemId}/leases",
  operationId: "listWorkItemLeases",
  summary: "List lease history for a work item",
  description:
    "Returns immutable lease history in monotonically increasing epoch order.",
  tags: ["leases"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    query: listWorkItemLeasesQuerySchema,
  },
  responses: {
    200: {
      description: "Work-item leases in epoch order",
      content: { "application/json": { schema: leaseListSchema } },
    },
    ...standardErrors,
  },
});

const listAttentionRequestsRoute = createRoute({
  method: "get",
  path: "/api/attention-requests",
  operationId: "listAttentionRequests",
  summary: "List attention requests",
  description:
    "Returns unresolved requests by default in stable request-ID order. Filters can include resolved requests or select blocking and non-blocking work.",
  tags: ["attention"],
  security: accessSecurity,
  request: { query: listAttentionRequestsQuerySchema },
  responses: {
    200: {
      description: "Attention requests in stable request-ID order",
      content: { "application/json": { schema: attentionRequestListSchema } },
    },
    ...standardErrors,
  },
});

const createAttentionRequestRoute = createRoute({
  method: "post",
  path: "/api/attention-requests",
  operationId: "createAttentionRequest",
  summary: "Request attention for claimed work",
  description:
    "Records the decision or review needed. A blocking request atomically ends the current lease and removes the work item from the claimable queue.",
  tags: ["attention"],
  security: accessSecurity,
  request: {
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: createAttentionRequestBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: "Attention request recorded or matching mutation replayed",
      content: {
        "application/json": { schema: attentionRequestResponseSchema },
      },
    },
    ...standardErrors,
  },
});

const resolveAttentionRequestRoute = createRoute({
  method: "post",
  path: "/api/attention-requests/{attentionRequestId}/resolutions",
  operationId: "createAttentionResolution",
  summary: "Resolve an attention request",
  description:
    "Records one resolution and returns the work item's newly derived stage. The item becomes ready only when no other readiness blocker remains.",
  tags: ["attention"],
  security: accessSecurity,
  request: {
    params: attentionRequestParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: resolveAttentionRequestBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: "Attention request resolved or matching mutation replayed",
      content: {
        "application/json": { schema: attentionResolutionResponseSchema },
      },
    },
    ...standardErrors,
  },
});

const createLeaseRoute = createRoute({
  method: "post",
  path: "/api/leases",
  operationId: "createLease",
  summary: "Claim a specified or first eligible work item",
  description:
    "Creates a fenced lease for the requested item, or for the highest-priority eligible item within optional initiative, project, and direct-parent filters when workItemId is absent.",
  tags: ["leases"],
  security: accessSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createLeaseBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Lease created and work item claimed",
      content: { "application/json": { schema: claimResponseSchema } },
    },
    ...standardErrors,
  },
});

const renewLeaseRoute = createRoute({
  method: "post",
  path: "/api/leases/{leaseId}/renewals",
  operationId: "createLeaseRenewal",
  summary: "Renew the current lease at its fenced epoch",
  description:
    "Extends a live lease only when its ID and epoch still identify the current worker claim.",
  tags: ["leases"],
  security: accessSecurity,
  request: {
    params: leaseParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: renewLeaseBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Lease expiry extended",
      content: { "application/json": { schema: leaseResponseSchema } },
    },
    ...standardErrors,
  },
});

const releaseWorkItemRoute = createRoute({
  method: "post",
  path: "/api/work-items/{workItemId}/releases",
  operationId: "createWorkItemRelease",
  summary: "Complete merged and deployed work at its fenced lease epoch",
  description:
    "Ends the current lease and changes the named work item's stored lifecycle to released only when the request identifies the merge and deployment evidence.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: releaseWorkItemBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Completed work released and lease ended",
      content: { "application/json": { schema: leaseWithWorkItemSchema } },
    },
    ...standardErrors,
  },
});

const cancelWorkItemRoute = createRoute({
  method: "post",
  path: "/api/work-items/{workItemId}/cancellations",
  operationId: "createWorkItemCancellation",
  summary: "Cancel claimed work at its fenced lease epoch",
  description:
    "Ends the current lease and changes the named work item's stored lifecycle to cancelled.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: terminateWorkItemBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Work item cancelled and lease ended",
      content: { "application/json": { schema: leaseWithWorkItemSchema } },
    },
    ...standardErrors,
  },
});

const createDecompositionRoute = createRoute({
  method: "post",
  path: "/api/work-items/{workItemId}/decompositions",
  operationId: "createWorkItemDecomposition",
  summary: "Decompose claimed work into ranked children",
  description:
    "Creates ranked children and dependency edges, ends the fenced parent lease with a decomposed outcome, and can claim one ready child for the same worker in one transaction. Children retain the parent link used to resolve inherited context.",
  tags: ["work-items"],
  security: accessSecurity,
  request: {
    params: workItemParamsSchema,
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: createDecompositionBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: "Work item decomposed or matching mutation replayed",
      content: { "application/json": { schema: decompositionResponseSchema } },
    },
    ...standardErrors,
  },
});

export interface WorkGraphApiRepository {
  projectCriticalPath(
    input?: ProjectCriticalPathInput,
  ): Promise<CriticalPathProjection>;
  listKnowledgeScopes(
    input?: ListKnowledgeScopesInput,
  ): Promise<readonly KnowledgeScope[]>;
  getKnowledgeScope(id: string): Promise<KnowledgeScope>;
  putKnowledgeScope(
    input: KnowledgeScopeInput,
    options?: IdempotentMutationOptions,
  ): Promise<KnowledgeScope>;
  archiveKnowledgeScope(
    id: string,
    input: ArchiveKnowledgeScopeInput,
    options?: IdempotentMutationOptions,
  ): Promise<KnowledgeScope>;
  restoreKnowledgeScope(
    id: string,
    options?: IdempotentMutationOptions,
  ): Promise<KnowledgeScope>;
  moveKnowledgeScopePriority(
    id: string,
    input: PriorityMoveInput,
    options?: IdempotentMutationOptions,
  ): Promise<KnowledgeScope>;
  listKnowledgeScopeRelationships(
    input?: ListKnowledgeScopeRelationshipsInput,
  ): Promise<
    readonly KnowledgeScopeRelationship[]
  >;
  addKnowledgeScopeRelationship(
    relationship: KnowledgeScopeRelationship,
    options?: IdempotentMutationOptions,
  ): Promise<void>;
  removeKnowledgeScopeRelationship(
    relationship: KnowledgeScopeRelationship,
    options?: IdempotentMutationOptions,
  ): Promise<void>;
  listWorkItems(
    input?: ListWorkItemsInput,
  ): Promise<readonly WorkItemReadModel[]>;
  getWorkItem(workItemId: string): Promise<WorkItemReadModel>;
  resolveWorkItemContext(
    workItemId: string,
  ): Promise<readonly ResolvedWorkItemContext[]>;
  listNotes(input: ListWorkItemNotesInput): Promise<readonly StoredNote[]>;
  listEvents(input?: ListEventsInput): Promise<readonly StoredEvent[]>;
  listDependencies(
    input: ListWorkItemDependenciesInput,
  ): Promise<readonly WorkItemDependency[]>;
  listLeases(
    input: ListWorkItemLeasesInput,
  ): Promise<readonly StoredLease[]>;
  listAttentionRequests(
    input?: ListAttentionRequestsInput,
  ): Promise<readonly AttentionRequestReadModel[]>;
  createWorkItem(
    input: NewWorkItemInput,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItem>;
  putWorkItemContext(
    input: WorkItemContext,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItemContext>;
  putWorkItemArchitectureDecision(
    input: WorkItemArchitectureDecision,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItemArchitectureDecision>;
  putWorkItemReference(
    input: WorkItemReference,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItemReference>;
  refreshPullRequest(
    input: PullRequestSnapshot,
    options?: IdempotentMutationOptions,
  ): Promise<PullRequestSnapshot>;
  putWorkItemPullRequest(
    input: WorkItemPullRequest,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItemPullRequest>;
  moveWorkItemPriority(
    workItemId: string,
    input: PriorityMoveInput,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItem>;
  reparentWorkItem(
    workItemId: string,
    parentId: string | null,
    options?: IdempotentMutationOptions,
  ): Promise<void>;
  setWorkItemSchedulingScope(
    workItemId: string,
    input: WorkItemSchedulingScopeInput,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItem>;
  expediteWorkItem(
    workItemId: string,
    reason: string,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItem>;
  unexpediteWorkItem(
    workItemId: string,
    options?: IdempotentMutationOptions,
  ): Promise<WorkItem>;
  addDependency(
    dependency: WorkItemDependency,
    options?: IdempotentMutationOptions,
  ): Promise<void>;
  removeDependency(
    dependency: WorkItemDependency,
    options?: IdempotentMutationOptions,
  ): Promise<void>;
  createNote(
    input: CreateNoteInput,
    options?: IdempotentMutationOptions,
  ): Promise<StoredNote>;
  createPostReleaseNote(
    input: CreatePostReleaseNoteInput,
    options?: IdempotentMutationOptions,
  ): Promise<StoredNote>;
  createAttentionRequest(
    input: CreateAttentionRequestInput,
    options?: IdempotentMutationOptions,
  ): Promise<CreateAttentionRequestResult>;
  resolveAttentionRequest(
    input: ResolveAttentionRequestInput,
    options?: IdempotentMutationOptions,
  ): Promise<ResolveAttentionRequestResult>;
  claimWorkItem(input: ClaimWorkItemInput): Promise<StoredLease | null>;
  renewLease(input: RenewLeaseInput): Promise<StoredLease>;
  terminateClaimedWorkItem(
    input: TerminateClaimedWorkItemInput,
  ): Promise<StoredLease>;
  decomposeClaimedWorkItem(
    input: DecomposeClaimedWorkItemInput,
    options?: IdempotentMutationOptions,
  ): Promise<DecomposeClaimedWorkItemResult>;
}

export interface WorkGraphAppOptions {
  readonly createLeaseId?: () => string;
}

const idempotencyOptions = (
  key: string | undefined,
): IdempotentMutationOptions =>
  key === undefined ? {} : { idempotencyKey: key };

const relationshipCursorTupleSchema = z.tuple([
  identifierSchema,
  identifierSchema,
]);

const encodeKnowledgeScopeRelationshipCursor = (
  relationship: KnowledgeScopeRelationship,
): string =>
  JSON.stringify([
    relationship.parentKnowledgeScopeId,
    relationship.childKnowledgeScopeId,
  ]);

const decodeKnowledgeScopeRelationshipCursor = (
  cursor: string,
): KnowledgeScopeRelationshipCursor => {
  try {
    const parsed = relationshipCursorTupleSchema.safeParse(JSON.parse(cursor));
    if (parsed.success) {
      return {
        parentKnowledgeScopeId: parsed.data[0],
        childKnowledgeScopeId: parsed.data[1],
      };
    }
  } catch {
    // The normalized error below keeps cursor internals out of API responses.
  }
  throw new WorkGraphError(
    "invalid_knowledge_scope_relationship_cursor",
    "The knowledge-scope relationship cursor is invalid.",
  );
};

const dependencyCursorTupleSchema = z.tuple([
  identifierSchema,
  identifierSchema,
]);

const encodeWorkItemDependencyCursor = (
  dependency: WorkItemDependency,
): string =>
  JSON.stringify([
    dependency.dependentWorkItemId,
    dependency.blockerWorkItemId,
  ]);

const decodeWorkItemDependencyCursor = (
  cursor: string,
): WorkItemDependencyCursor => {
  try {
    const parsed = dependencyCursorTupleSchema.safeParse(JSON.parse(cursor));
    if (parsed.success) {
      return {
        dependentWorkItemId: parsed.data[0],
        blockerWorkItemId: parsed.data[1],
      };
    }
  } catch {
    // The normalized error below keeps cursor internals out of API responses.
  }
  throw new WorkGraphError(
    "invalid_work_item_dependency_cursor",
    "The work-item dependency cursor is invalid.",
  );
};

const serializeLease = (storedLease: StoredLease) => ({
  ...storedLease,
  acquiredAt: storedLease.acquiredAt.toISOString(),
  expiresAt: storedLease.expiresAt.toISOString(),
  endedAt: storedLease.endedAt?.toISOString() ?? null,
});

const serializeWorkItem = (item: WorkItemReadModel) => ({
  ...item,
  currentLease: item.currentLease ? serializeLease(item.currentLease) : null,
});

const serializeNote = (storedNote: StoredNote) => ({
  ...storedNote,
  kind:
    storedNote.leaseId === null
      ? ("post_release" as const)
      : ("work" as const),
  createdAt: storedNote.createdAt.toISOString(),
});

const serializeEvent = (storedEvent: StoredEvent) => {
  if (!workItemEventTypes.has(storedEvent.type)) {
    throw new Error(`Unknown stored work-item event type ${storedEvent.type}.`);
  }
  return {
    ...storedEvent,
    type: storedEvent.type as (typeof WORK_ITEM_EVENT_TYPES)[number],
    occurredAt: storedEvent.occurredAt.toISOString(),
  };
};

const serializeAttentionRequest = (stored: StoredAttentionRequest) => ({
  ...stored,
  createdAt: stored.createdAt.toISOString(),
});

const serializeAttentionResolution = (
  stored: StoredAttentionResolution,
) => ({
  ...stored,
  createdAt: stored.createdAt.toISOString(),
});

const serializeAttentionRequestReadModel = (
  stored: AttentionRequestReadModel,
) => ({
  ...serializeAttentionRequest(stored),
  resolution: stored.resolution
    ? serializeAttentionResolution(stored.resolution)
    : null,
});

const validationHook: Hook<unknown, Env, string, Response | void> = (
  result,
  context,
) => {
  if (result.success) return;
  return context.json(
    {
      error: {
        code: "validation_failed",
        message: "The request does not match the API contract.",
        details: result.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    },
    422,
  );
};

const statusForWorkGraphError = (error: WorkGraphError): 400 | 404 | 409 => {
  if (
    error.code === "work_item_not_found" ||
    error.code === "attention_request_not_found" ||
    error.code === "knowledge_scope_not_found" ||
    error.code === "pull_request_not_found"
  ) {
    return 404;
  }
  if (error.code.startsWith("invalid_")) return 400;
  return 409;
};

const requireBoundedCriticalPath = (
  projection: CriticalPathProjection,
): CriticalPathProjection => {
  const parallelPathCount = projection.parallelBranches.reduce(
    (total, branch) => total + branch.paths.length,
    0,
  );
  const tooLarge =
    projection.nodes.length > MAX_CRITICAL_PATH_NODES ||
    projection.edges.length > MAX_CRITICAL_PATH_EDGES ||
    projection.blockingPaths.length > MAX_CRITICAL_PATH_BLOCKING_PATHS ||
    projection.blockingPaths.some(
      (path) => path.length > MAX_CRITICAL_PATH_NODES,
    ) ||
    projection.parallelBranches.length > MAX_CRITICAL_PATH_NODES ||
    parallelPathCount > MAX_CRITICAL_PATH_BLOCKING_PATHS ||
    projection.parallelBranches.some((branch) =>
      branch.paths.some((path) => path.length > MAX_CRITICAL_PATH_NODES),
    );
  if (tooLarge) {
    throw new WorkGraphError(
      "critical_path_projection_too_large",
      `The critical-path projection exceeds the response limit of ${MAX_CRITICAL_PATH_NODES} nodes, ${MAX_CRITICAL_PATH_EDGES} edges, or ${MAX_CRITICAL_PATH_BLOCKING_PATHS} paths. Narrow the request by initiative, project, or root work item.`,
    );
  }
  return projection;
};

export const createWorkGraphApp = (
  repository: WorkGraphApiRepository,
  options: WorkGraphAppOptions = {},
) => {
  const app = new OpenAPIHono({ defaultHook: validationHook });
  const createLeaseId = options.createLeaseId ?? (() => crypto.randomUUID());

  app.openAPIRegistry.registerComponent(
    "securitySchemes",
    "cloudflareAccessClientId",
    {
      type: "apiKey",
      in: "header",
      name: "CF-Access-Client-Id",
      description: "Cloudflare Access service-token client ID",
    },
  );
  app.openAPIRegistry.registerComponent(
    "securitySchemes",
    "cloudflareAccessClientSecret",
    {
      type: "apiKey",
      in: "header",
      name: "CF-Access-Client-Secret",
      description: "Cloudflare Access service-token client secret",
    },
  );

  app.onError((error, context) => {
    if (error instanceof WorkGraphError) {
      return context.json(
        { error: { code: error.code, message: error.message } },
        statusForWorkGraphError(error),
      );
    }
    console.error(
      JSON.stringify({
        message: "Work Graph request failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return context.json(
      {
        error: {
          code: "internal_error",
          message: "The Work Graph request failed.",
        },
      },
      500,
    );
  });
  app.notFound((context) =>
    context.json(
      { error: { code: "not_found", message: "Resource not found." } },
      404,
    ),
  );

  app.openapi(getCriticalPathRoute, async (context) => {
    const { initiativeId, projectId, rootWorkItemId } =
      context.req.valid("query");
    const projection = await repository.projectCriticalPath({
      ...(initiativeId === undefined ? {} : { initiativeId }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(rootWorkItemId === undefined ? {} : { rootWorkItemId }),
    });
    return context.json(
      criticalPathProjectionSchema.parse(
        requireBoundedCriticalPath(projection),
      ),
      200,
    );
  });

  app.openapi(listWorkItemsRoute, async (context) => {
    const { cursor, initiativeId, limit, parentId, projectId, stage } =
      context.req.valid("query");
    const items = await repository.listWorkItems({
      ...(initiativeId === undefined ? {} : { initiativeId }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(parentId === undefined ? {} : { parentId }),
    });
    const cursorIndex =
      cursor === undefined
        ? -1
        : items.findIndex((item) => item.id === cursor);
    const remainingItems =
      cursor !== undefined && cursorIndex === -1
        ? []
        : items.slice(cursorIndex + 1);
    const matchingItems = remainingItems.filter(
      (item) => stage === undefined || item.stage === stage,
    );
    const page = matchingItems.slice(0, limit);
    return context.json(
      {
        items: page.map(serializeWorkItem),
        nextCursor:
          page.length < matchingItems.length
            ? (page.at(-1)?.id ?? null)
            : null,
      },
      200,
    );
  });

  app.openapi(listKnowledgeScopesRoute, async (context) => {
    const { cursor, includeArchived, kind, limit } =
      context.req.valid("query");
    const scopes = await repository.listKnowledgeScopes({
      ...(kind === undefined ? {} : { kind }),
      ...(includeArchived === undefined ? {} : { includeArchived: true }),
      ...(cursor === undefined ? {} : { cursor }),
      limit: limit + 1,
    });
    const page = scopes.slice(0, limit);
    return context.json(
      {
        items: page,
        nextCursor: scopes.length > limit ? (page.at(-1)?.id ?? null) : null,
      },
      200,
    );
  });

  app.openapi(getKnowledgeScopeRoute, async (context) => {
    const { knowledgeScopeId } = context.req.valid("param");
    return context.json(
      await repository.getKnowledgeScope(knowledgeScopeId),
      200,
    );
  });

  app.openapi(putKnowledgeScopeRoute, async (context) => {
    const { knowledgeScopeId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    return context.json(
      await repository.putKnowledgeScope(
        { id: knowledgeScopeId, ...request },
        idempotencyOptions(headers["idempotency-key"]),
      ),
      200,
    );
  });

  app.openapi(archiveKnowledgeScopeRoute, async (context) => {
    const { knowledgeScopeId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    return context.json(
      await repository.archiveKnowledgeScope(
        knowledgeScopeId,
        request,
        idempotencyOptions(headers["idempotency-key"]),
      ),
      200,
    );
  });

  app.openapi(restoreKnowledgeScopeRoute, async (context) => {
    const { knowledgeScopeId } = context.req.valid("param");
    const headers = context.req.valid("header");
    return context.json(
      await repository.restoreKnowledgeScope(
        knowledgeScopeId,
        idempotencyOptions(headers["idempotency-key"]),
      ),
      200,
    );
  });

  app.openapi(moveKnowledgeScopePriorityRoute, async (context) => {
    const { knowledgeScopeId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    return context.json(
      await repository.moveKnowledgeScopePriority(
        knowledgeScopeId,
        request,
        idempotencyOptions(headers["idempotency-key"]),
      ),
      200,
    );
  });

  app.openapi(listKnowledgeScopeRelationshipsRoute, async (context) => {
    const { cursor, includeArchived, limit } = context.req.valid("query");
    const relationships = await repository.listKnowledgeScopeRelationships({
      ...(includeArchived === undefined ? {} : { includeArchived: true }),
      ...(cursor === undefined
        ? {}
        : { cursor: decodeKnowledgeScopeRelationshipCursor(cursor) }),
      limit: limit + 1,
    });
    const page = relationships.slice(0, limit);
    const last = page.at(-1);
    return context.json(
      {
        items: page,
        nextCursor:
          relationships.length > limit && last
            ? encodeKnowledgeScopeRelationshipCursor(last)
            : null,
      },
      200,
    );
  });

  app.openapi(createKnowledgeScopeRelationshipRoute, async (context) => {
    const relationship = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.addKnowledgeScopeRelationship(
      relationship,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(relationship, 201);
  });

  app.openapi(deleteKnowledgeScopeRelationshipRoute, async (context) => {
    const relationship = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.removeKnowledgeScopeRelationship(
      relationship,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(relationship, 200);
  });

  app.openapi(getWorkItemRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    return context.json(
      serializeWorkItem(await repository.getWorkItem(workItemId)),
      200,
    );
  });

  app.openapi(listWorkItemContextsRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    return context.json(
      { items: [...(await repository.resolveWorkItemContext(workItemId))] },
      200,
    );
  });

  app.openapi(putWorkItemContextRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    const options = idempotencyOptions(
      context.req.valid("header")["idempotency-key"],
    );
    if (request.kind === "architecture_decision") {
      const stored = await repository.putWorkItemArchitectureDecision(
        {
          workItemId,
          title: request.title,
          url: request.url,
          role: request.role,
        },
        options,
      );
      return context.json(
        { kind: "architecture_decision" as const, ...stored },
        200,
      );
    }
    return context.json(
      await repository.putWorkItemContext({ workItemId, ...request }, options),
      200,
    );
  });

  app.openapi(putWorkItemReferenceRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    return context.json(
      await repository.putWorkItemReference(
        { workItemId, ...request },
        idempotencyOptions(
          context.req.valid("header")["idempotency-key"],
        ),
      ),
      200,
    );
  });

  app.openapi(refreshPullRequestRoute, async (context) => {
    return context.json(
      await repository.refreshPullRequest(
        context.req.valid("json"),
        idempotencyOptions(
          context.req.valid("header")["idempotency-key"],
        ),
      ),
      200,
    );
  });

  app.openapi(listWorkItemPullRequestsRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const resolved = await repository.resolveWorkItemContext(workItemId);
    return context.json(
      {
        items: resolved.filter(
          (item): item is Extract<
            ResolvedWorkItemContext,
            { kind: "pull_request" }
          > => item.kind === "pull_request",
        ),
      },
      200,
    );
  });

  app.openapi(putWorkItemPullRequestRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    return context.json(
      await repository.putWorkItemPullRequest(
        { workItemId, ...context.req.valid("json") },
        idempotencyOptions(
          context.req.valid("header")["idempotency-key"],
        ),
      ),
      200,
    );
  });

  app.openapi(createWorkItemRoute, async (context) => {
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.createWorkItem(
      request,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(
      serializeWorkItem(await repository.getWorkItem(request.id)),
      201,
    );
  });

  app.openapi(putWorkItemParentRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const { parentId } = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.reparentWorkItem(
      workItemId,
      parentId,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(
      serializeWorkItem(await repository.getWorkItem(workItemId)),
      200,
    );
  });

  app.openapi(moveWorkItemPriorityRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.moveWorkItemPriority(
      workItemId,
      request,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(
      serializeWorkItem(await repository.getWorkItem(workItemId)),
      200,
    );
  });

  app.openapi(putWorkItemSchedulingScopeRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.setWorkItemSchedulingScope(
      workItemId,
      request,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(
      serializeWorkItem(await repository.getWorkItem(workItemId)),
      200,
    );
  });

  app.openapi(expediteWorkItemRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const { reason } = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.expediteWorkItem(
      workItemId,
      reason,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(
      serializeWorkItem(await repository.getWorkItem(workItemId)),
      200,
    );
  });

  app.openapi(unexpediteWorkItemRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const headers = context.req.valid("header");
    await repository.unexpediteWorkItem(
      workItemId,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(
      serializeWorkItem(await repository.getWorkItem(workItemId)),
      200,
    );
  });

  app.openapi(createDependencyRoute, async (context) => {
    const dependency = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.addDependency(
      dependency,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(dependency, 201);
  });

  app.openapi(deleteDependencyRoute, async (context) => {
    const dependency = context.req.valid("json");
    const headers = context.req.valid("header");
    await repository.removeDependency(
      dependency,
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(dependency, 200);
  });

  app.openapi(createNoteRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    const created = await repository.createNote(
      { ...request, workItemId },
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(serializeNote(created), 201);
  });

  app.openapi(createPostReleaseNoteRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    const created = await repository.createPostReleaseNote(
      { ...request, workItemId },
      idempotencyOptions(headers["idempotency-key"]),
    );
    return context.json(serializeNote(created), 201);
  });

  app.openapi(listWorkItemNotesRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const { cursor, limit } = context.req.valid("query");
    await repository.getWorkItem(workItemId);
    const notes = await repository.listNotes({
      workItemId,
      ...(cursor === undefined ? {} : { cursor }),
      limit: limit + 1,
    });
    const page = notes.slice(0, limit);
    const last = page.at(-1);
    return context.json(
      {
        items: page.map(serializeNote),
        nextCursor: notes.length > limit && last ? last.id : null,
      },
      200,
    );
  });

  app.openapi(listWorkItemEventsRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const { afterSequence, lifecycle, limit, type } =
      context.req.valid("query");
    await repository.getWorkItem(workItemId);
    const events = await repository.listEvents({
      workItemId,
      ...(type === undefined ? {} : { type }),
      ...(lifecycle === undefined ? {} : { lifecycle }),
      ...(afterSequence === undefined ? {} : { afterSequence }),
      limit: limit + 1,
    });
    const page = events.slice(0, limit);
    return context.json(
      {
        items: page.map(serializeEvent),
        nextCursor:
          events.length > limit ? (page.at(-1)?.sequence ?? null) : null,
      },
      200,
    );
  });

  app.openapi(listWorkItemDependenciesRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const { cursor, limit } = context.req.valid("query");
    await repository.getWorkItem(workItemId);
    const dependencies = await repository.listDependencies({
      workItemId,
      ...(cursor === undefined
        ? {}
        : { cursor: decodeWorkItemDependencyCursor(cursor) }),
      limit: limit + 1,
    });
    const page = dependencies.slice(0, limit);
    const last = page.at(-1);
    return context.json(
      {
        items: page,
        nextCursor:
          dependencies.length > limit && last
            ? encodeWorkItemDependencyCursor(last)
            : null,
      },
      200,
    );
  });

  app.openapi(listWorkItemLeasesRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const { afterEpoch, limit } = context.req.valid("query");
    await repository.getWorkItem(workItemId);
    const leases = await repository.listLeases({
      workItemId,
      ...(afterEpoch === undefined ? {} : { afterEpoch }),
      limit: limit + 1,
    });
    const page = leases.slice(0, limit);
    return context.json(
      {
        items: page.map(serializeLease),
        nextCursor: leases.length > limit ? (page.at(-1)?.epoch ?? null) : null,
      },
      200,
    );
  });

  app.openapi(listAttentionRequestsRoute, async (context) => {
    const { blocking, cursor, limit, state, workItemId } =
      context.req.valid("query");
    if (workItemId !== undefined) {
      await repository.getWorkItem(workItemId);
    }
    const requests = await repository.listAttentionRequests({
      ...(workItemId === undefined ? {} : { workItemId }),
      ...(state === "all" ? {} : { state }),
      limit: limit + 1,
      ...(blocking === undefined ? {} : { blocking: blocking === "true" }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    const page = requests.slice(0, limit);
    return context.json(
      {
        items: page.map(serializeAttentionRequestReadModel),
        nextCursor: requests.length > limit ? (page.at(-1)?.id ?? null) : null,
      },
      200,
    );
  });

  app.openapi(createAttentionRequestRoute, async (context) => {
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    const created = await repository.createAttentionRequest(
      request,
      idempotencyOptions(headers["idempotency-key"]),
    );
    const item = await repository.getWorkItem(request.workItemId);
    return context.json(
      {
        attentionRequest: serializeAttentionRequest(
          created.attentionRequest,
        ),
        endedLease: created.endedLease
          ? serializeLease(created.endedLease)
          : null,
        workItem: serializeWorkItem(item),
      },
      201,
    );
  });

  app.openapi(resolveAttentionRequestRoute, async (context) => {
    const { attentionRequestId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    const resolved = await repository.resolveAttentionRequest(
      { ...request, attentionRequestId },
      idempotencyOptions(headers["idempotency-key"]),
    );
    const item = await repository.getWorkItem(resolved.workItemId);
    return context.json(
      {
        resolution: serializeAttentionResolution(resolved.resolution),
        workItem: serializeWorkItem(item),
      },
      201,
    );
  });

  app.openapi(createLeaseRoute, async (context) => {
    const request = context.req.valid("json");
    const selection =
      "workItemId" in request
        ? { workItemId: request.workItemId }
        : {
            ...(request.initiativeId
              ? { initiativeId: request.initiativeId }
              : {}),
            ...(request.projectId ? { projectId: request.projectId } : {}),
            ...(request.parentId ? { parentId: request.parentId } : {}),
          };
    const claimed = await repository.claimWorkItem({
      leaseId: createLeaseId(),
      workerId: request.workerId,
      leaseDurationSeconds: request.leaseDurationSeconds,
      ...selection,
    });
    if (!claimed) {
      return context.json(
        {
          error: {
            code: "work_item_not_claimable",
            message: "workItemId" in request
              ? `Work item ${request.workItemId} is not claimable.`
              : "No work item is currently claimable.",
          },
        },
        409,
      );
    }
    const item = await repository.getWorkItem(claimed.workItemId);
    return context.json(
      {
        lease: serializeLease(claimed),
        workItem: serializeWorkItem(item),
        context: [
          ...(await repository.resolveWorkItemContext(claimed.workItemId)),
        ],
      },
      201,
    );
  });

  app.openapi(renewLeaseRoute, async (context) => {
    const { leaseId } = context.req.valid("param");
    const request = context.req.valid("json");
    const renewed = await repository.renewLease({ leaseId, ...request });
    return context.json({ lease: serializeLease(renewed) }, 200);
  });

  app.openapi(releaseWorkItemRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    const ended = await repository.terminateClaimedWorkItem({
      ...request,
      workItemId,
      outcome: "released",
    });
    const item = await repository.getWorkItem(workItemId);
    return context.json(
      { lease: serializeLease(ended), workItem: serializeWorkItem(item) },
      201,
    );
  });

  app.openapi(cancelWorkItemRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    const ended = await repository.terminateClaimedWorkItem({
      ...request,
      workItemId,
      outcome: "cancelled",
    });
    const item = await repository.getWorkItem(workItemId);
    return context.json(
      { lease: serializeLease(ended), workItem: serializeWorkItem(item) },
      201,
    );
  });

  app.openapi(createDecompositionRoute, async (context) => {
    const { workItemId } = context.req.valid("param");
    const request = context.req.valid("json");
    const headers = context.req.valid("header");
    const decomposed = await repository.decomposeClaimedWorkItem(
      { ...request, workItemId },
      idempotencyOptions(headers["idempotency-key"]),
    );
    const projection = new Map(
      (await repository.listWorkItems()).map((item) => [item.id, item]),
    );
    const parent = projection.get(workItemId);
    if (!parent) throw new Error("Decomposition parent projection is missing.");
    return context.json(
      {
        parent: serializeWorkItem(parent),
        children: decomposed.children.map(({ rank, workItem: created }) => {
          const child = projection.get(created.id);
          if (!child) {
            throw new Error("Decomposition child projection is missing.");
          }
          return { rank, workItem: serializeWorkItem(child) };
        }),
        dependencies: [...decomposed.dependencies],
        endedLease: serializeLease(decomposed.endedLease),
        claimedLease: decomposed.claimedLease
          ? serializeLease(decomposed.claimedLease)
          : null,
      },
      201,
    );
  });

  return app;
};
