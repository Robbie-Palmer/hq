import { z } from "zod";

import {
  type EvidenceRequirement,
  type TaskRequirements,
  TaskRequirementsSchema,
} from "./task";
import { compareIdentifiers, IdentifierSchema } from "./vocabulary";

const TimestampSchema = z.iso.datetime();
const LeaseDurationSecondsSchema = z.number().int().min(60).max(86_400);
const PageSizeSchema = z.number().int().min(1).max(100);

export const WorkGraphLeaseSchema = z
  .object({
    id: z.uuid(),
    workItemId: IdentifierSchema,
    workerId: IdentifierSchema,
    epoch: z.number().int().positive(),
    acquiredAt: TimestampSchema,
    expiresAt: TimestampSchema,
    endedAt: z.union([TimestampSchema, z.null()]),
    outcome: z.union([
      z.enum([
        "released",
        "cancelled",
        "decomposed",
        "attention_requested",
        "expired",
      ]),
      z.null(),
    ]),
  })
  .strict();
export type WorkGraphLease = z.infer<typeof WorkGraphLeaseSchema>;

export const WorkGraphWorkItemSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().trim().min(1),
    lifecycle: z.enum(["open", "released", "cancelled"]),
    parentId: z.union([IdentifierSchema, z.null()]),
    rank: z.union([z.number().int(), z.null()]),
    priorityRank: z.union([z.number().int(), z.null()]),
    schedulingInitiativeId: z.union([IdentifierSchema, z.null()]),
    schedulingProjectId: z.union([IdentifierSchema, z.null()]),
    expedited: z.boolean(),
    expediteReason: z.union([z.string().trim().min(1), z.null()]),
    stage: z.enum([
      "blocked",
      "ready",
      "in_progress",
      "stale",
      "needs_attention",
      "released",
      "cancelled",
    ]),
    currentLease: z.union([WorkGraphLeaseSchema, z.null()]),
    priority: z
      .object({
        initiativeRank: z.number().int(),
        projectRank: z.number().int(),
        ticketRank: z.number().int(),
        expedited: z.boolean(),
        effectiveExpedited: z.boolean(),
        donatedFromWorkItemId: z.union([IdentifierSchema, z.null()]),
      })
      .strict(),
  })
  .strict();
export type WorkGraphWorkItem = z.infer<typeof WorkGraphWorkItemSchema>;

const ResolvedTextContextSchema = z
  .object({
    kind: z.enum(["brief", "acceptance_criteria"]),
    content: z.string().trim().min(1),
    sourceWorkItemId: IdentifierSchema,
    inheritanceDepth: z.number().int().nonnegative(),
  })
  .strict();

export const WorkGraphArchitectureDecisionSchema = z
  .object({
    kind: z.literal("architecture_decision"),
    title: z.string().trim().min(1),
    url: z.url(),
    role: z.enum(["governing", "background"]),
    sourceWorkItemId: IdentifierSchema,
    inheritanceDepth: z.number().int().nonnegative(),
  })
  .strict();
export type WorkGraphArchitectureDecision = z.infer<
  typeof WorkGraphArchitectureDecisionSchema
>;

export const WorkGraphReferenceSchema = z
  .object({
    kind: z.literal("reference"),
    title: z.string().trim().min(1),
    url: z.url(),
    sourceWorkItemId: IdentifierSchema,
    inheritanceDepth: z.number().int().nonnegative(),
  })
  .strict();
export type WorkGraphReference = z.infer<typeof WorkGraphReferenceSchema>;

const IgnoredResolvedContextSchema = z.looseObject({
  kind: z.enum(["project", "initiative", "pull_request"]),
  sourceWorkItemId: IdentifierSchema,
  inheritanceDepth: z.number().int().nonnegative(),
});

const ResolvedContextSchema = z.union([
  ResolvedTextContextSchema,
  WorkGraphArchitectureDecisionSchema,
  WorkGraphReferenceSchema,
  IgnoredResolvedContextSchema,
]);
type ResolvedContext = z.infer<typeof ResolvedContextSchema>;

export const WorkGraphDependencySchema = z
  .object({
    dependentWorkItemId: IdentifierSchema,
    blockerWorkItemId: IdentifierSchema,
  })
  .strict();
export type WorkGraphDependency = z.infer<typeof WorkGraphDependencySchema>;

export const WorkGraphNoteSchema = z
  .object({
    id: z.uuid(),
    workItemId: IdentifierSchema,
    kind: z.enum(["work", "post_release"]),
    leaseId: z.union([z.uuid(), z.null()]),
    author: IdentifierSchema,
    content: z.string().trim().min(1),
    createdAt: TimestampSchema,
  })
  .strict();
export type WorkGraphNote = z.infer<typeof WorkGraphNoteSchema>;

export const WorkGraphRequirementsSchema = z
  .object({
    workItemId: IdentifierSchema,
    brief: ResolvedTextContextSchema.extend({ kind: z.literal("brief") }),
    acceptanceCriteria: ResolvedTextContextSchema.extend({
      kind: z.literal("acceptance_criteria"),
    }),
  })
  .strict();
export type WorkGraphRequirements = z.infer<
  typeof WorkGraphRequirementsSchema
>;

export const WorkGraphContextPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    workItem: WorkGraphWorkItemSchema,
    taskRequirements: TaskRequirementsSchema,
    brief: WorkGraphRequirementsSchema.shape.brief,
    acceptanceCriteria:
      WorkGraphRequirementsSchema.shape.acceptanceCriteria,
    dependencies: z.array(WorkGraphDependencySchema),
    architectureDecisions: z.array(WorkGraphArchitectureDecisionSchema),
    references: z.array(WorkGraphReferenceSchema),
    notes: z.array(WorkGraphNoteSchema),
    requiredEvidence: TaskRequirementsSchema.shape.requiredEvidence,
  })
  .strict();
export type WorkGraphContextPackage = z.infer<
  typeof WorkGraphContextPackageSchema
>;

export const WorkGraphScopeSchema = z
  .object({
    initiativeId: IdentifierSchema.optional(),
    projectId: IdentifierSchema.optional(),
    parentId: IdentifierSchema.optional(),
  })
  .strict();
export type WorkGraphScope = z.infer<typeof WorkGraphScopeSchema>;

export const ReadyWorkPageSchema = z
  .object({
    items: z.array(WorkGraphWorkItemSchema),
    nextCursor: z.union([IdentifierSchema, z.null()]),
  })
  .strict();
export type ReadyWorkPage = z.infer<typeof ReadyWorkPageSchema>;

export const LeaseHandleSchema = z.object({
  id: z.uuid(),
  workItemId: IdentifierSchema,
  workerId: IdentifierSchema,
  epoch: z.number().int().positive(),
  expiresAt: TimestampSchema,
});
export type LeaseHandle = z.infer<typeof LeaseHandleSchema>;

export const LeaseObservationSchema = z
  .object({
    status: z.enum(["active", "expired", "ended", "superseded"]),
    lease: WorkGraphLeaseSchema,
    workItem: WorkGraphWorkItemSchema,
  })
  .strict();
export type LeaseObservation = z.infer<typeof LeaseObservationSchema>;

export const ClaimedWorkSchema = z
  .object({
    lease: WorkGraphLeaseSchema,
    workItem: WorkGraphWorkItemSchema,
    context: WorkGraphContextPackageSchema,
  })
  .strict();
export type ClaimedWork = z.infer<typeof ClaimedWorkSchema>;

export const CheckpointResultSchema = z
  .object({
    note: WorkGraphNoteSchema,
    lease: LeaseHandleSchema,
  })
  .strict();
export type CheckpointResult = z.infer<typeof CheckpointResultSchema>;

export type WorkGraphIntegrationErrorCode =
  | "claim_conflict"
  | "context_conflict"
  | "context_limit_exceeded"
  | "integration_unavailable"
  | "invalid_response"
  | "lease_expired"
  | "lease_not_found"
  | "missing_context"
  | "stale_lease"
  | "work_item_mismatch"
  | "work_item_not_found";

export class WorkGraphIntegrationError extends Error {
  readonly code: WorkGraphIntegrationErrorCode;
  readonly details?: unknown;

  constructor(
    code: WorkGraphIntegrationErrorCode,
    message: string,
    options: { cause?: unknown; details?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "WorkGraphIntegrationError";
    this.code = code;
    this.details = options.details;
  }
}

/**
 * The repository's WorkGraphClient satisfies this shape. Keeping a structural
 * port here leaves authentication and HTTP retry policy in that client.
 */
export interface WorkGraphClientPort {
  listWorkItems(query: {
    stage: "ready";
    initiativeId?: string;
    projectId?: string;
    parentId?: string;
    limit: number;
    cursor?: string;
  }): Promise<unknown>;
  getWorkItem(workItemId: string): Promise<unknown>;
  listWorkItemContexts(workItemId: string): Promise<unknown>;
  listWorkItemDependencies(
    workItemId: string,
    query: { limit: number; cursor?: string },
  ): Promise<unknown>;
  listWorkItemNotes(
    workItemId: string,
    query: { limit: number; cursor?: string },
  ): Promise<unknown>;
  listWorkItemLeases(
    workItemId: string,
    query: { limit: number; afterEpoch?: number },
  ): Promise<unknown>;
  claim(body: {
    workerId: string;
    leaseDurationSeconds: number;
    workItemId: string;
  }): Promise<unknown>;
  renew(
    leaseId: string,
    body: { epoch: number; leaseDurationSeconds: number },
  ): Promise<unknown>;
  createNote(
    workItemId: string,
    body: { id: string; leaseId: string; epoch: number; content: string },
    idempotencyKey?: string,
  ): Promise<unknown>;
  release(
    workItemId: string,
    body: {
      leaseId: string;
      epoch: number;
      mergeEvidence: string;
      deploymentEvidence: string;
    },
  ): Promise<unknown>;
}

export interface WorkGraphCoordinatorOptions {
  readonly createId?: () => string;
  readonly maxContextRecords?: number;
  readonly maxDependencies?: number;
  readonly maxNotes?: number;
  readonly maxPackageBytes?: number;
  readonly now?: () => number;
}

interface ResolvedOptions {
  createId: () => string;
  maxContextRecords: number;
  maxDependencies: number;
  maxNotes: number;
  maxPackageBytes: number;
  now: () => number;
}

const resolveOptions = (
  options: WorkGraphCoordinatorOptions,
): ResolvedOptions => {
  const boundedPageSize = (value: number | undefined, fallback: number) =>
    z.number().int().min(1).max(99).parse(value ?? fallback);
  return {
    createId: options.createId ?? (() => crypto.randomUUID()),
    maxContextRecords: z
      .number()
      .int()
      .min(2)
      .max(1_000)
      .parse(options.maxContextRecords ?? 100),
    maxDependencies: boundedPageSize(options.maxDependencies, 50),
    maxNotes: boundedPageSize(options.maxNotes, 50),
    maxPackageBytes: z
      .number()
      .int()
      .min(1_024)
      .max(1_048_576)
      .parse(options.maxPackageBytes ?? 65_536),
    now: options.now ?? Date.now,
  };
};

const WorkItemListResponseSchema = z
  .object({
    items: z.array(WorkGraphWorkItemSchema).max(100),
    nextCursor: z.union([IdentifierSchema, z.null()]),
  })
  .strict();
const WorkItemResponseSchema = WorkGraphWorkItemSchema;
const ContextResponseSchema = z
  .object({ items: z.array(ResolvedContextSchema).max(1_000) })
  .strict();
const DependencyResponseSchema = z
  .object({
    items: z.array(WorkGraphDependencySchema).max(100),
    nextCursor: z.union([z.string().min(1), z.null()]),
  })
  .strict();
const NoteResponseSchema = z
  .object({
    items: z.array(WorkGraphNoteSchema).max(100),
    nextCursor: z.union([z.uuid(), z.null()]),
  })
  .strict();
const LeaseListResponseSchema = z
  .object({
    items: z.array(WorkGraphLeaseSchema).max(100),
    nextCursor: z.union([z.number().int().positive(), z.null()]),
  })
  .strict();
const ClaimResponseSchema = z
  .object({
    lease: WorkGraphLeaseSchema,
    workItem: WorkGraphWorkItemSchema,
    context: z.array(ResolvedContextSchema).max(1_000),
  })
  .strict();
const LeaseResponseSchema = z
  .object({ lease: WorkGraphLeaseSchema })
  .strict();
const NoteMutationResponseSchema = WorkGraphNoteSchema;
const ReleaseResponseSchema = z
  .object({
    lease: WorkGraphLeaseSchema,
    workItem: WorkGraphWorkItemSchema,
  })
  .strict();

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right, "en");

const evidenceStageRank: Record<EvidenceRequirement["stage"], number> = {
  claim: 0,
  checkpoint: 1,
  completion: 2,
};

const requirementsFromContext = (
  workItemId: string,
  records: readonly ResolvedContext[],
): WorkGraphRequirements => {
  const briefs = records.filter(
    (record): record is z.infer<typeof ResolvedTextContextSchema> & {
      kind: "brief";
    } => record.kind === "brief",
  );
  const acceptanceCriteria = records.filter(
    (record): record is z.infer<typeof ResolvedTextContextSchema> & {
      kind: "acceptance_criteria";
    } => record.kind === "acceptance_criteria",
  );
  for (const [label, matches] of [
    ["brief", briefs],
    ["acceptance criteria", acceptanceCriteria],
  ] as const) {
    if (matches.length === 0) {
      throw new WorkGraphIntegrationError(
        "missing_context",
        `Work item ${workItemId} has no resolved ${label}. Add it before routing the work.`,
      );
    }
    if (matches.length > 1) {
      throw new WorkGraphIntegrationError(
        "context_conflict",
        `Work item ${workItemId} resolved more than one ${label}. Remove the conflicting context records.`,
      );
    }
  }
  const brief = briefs[0];
  const criteria = acceptanceCriteria[0];
  if (!brief || !criteria) {
    throw new WorkGraphIntegrationError(
      "missing_context",
      `Work item ${workItemId} does not have complete requirements.`,
    );
  }
  return WorkGraphRequirementsSchema.parse({
    workItemId,
    brief,
    acceptanceCriteria: criteria,
  });
};

const uniqueByUrl = <
  Item extends { readonly kind: string; readonly url: string },
>(workItemId: string, items: readonly Item[]): Item[] => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.url)) {
      throw new WorkGraphIntegrationError(
        "context_conflict",
        `Work item ${workItemId} resolved ${item.url} more than once. Remove the duplicate ${item.kind} link.`,
      );
    }
    seen.add(item.url);
  }
  return [...items];
};

const statusOfError = (error: unknown): number | undefined =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number"
    ? error.status
    : undefined;

export class WorkGraphCoordinator {
  readonly #client: WorkGraphClientPort;
  readonly #options: ResolvedOptions;

  constructor(
    client: WorkGraphClientPort,
    options: WorkGraphCoordinatorOptions = {},
  ) {
    this.#client = client;
    this.#options = resolveOptions(options);
  }

  async listReadyCandidates(
    scope: WorkGraphScope = {},
    page: { limit?: number; cursor?: string } = {},
  ): Promise<ReadyWorkPage> {
    const parsedScope = WorkGraphScopeSchema.parse(scope);
    const limit = PageSizeSchema.parse(page.limit ?? 20);
    const cursor = page.cursor && IdentifierSchema.parse(page.cursor);
    const response = await this.#read(
      "list ready work",
      () =>
        this.#client.listWorkItems({
          stage: "ready",
          ...parsedScope,
          limit,
          ...(cursor ? { cursor } : {}),
        }),
      WorkItemListResponseSchema,
    );
    if (response.items.some((item) => item.stage !== "ready")) {
      throw new WorkGraphIntegrationError(
        "invalid_response",
        "Work Graph returned a non-ready item in a ready-work query.",
      );
    }
    return ReadyWorkPageSchema.parse(response);
  }

  async readRequirements(workItemId: string): Promise<WorkGraphRequirements> {
    const id = IdentifierSchema.parse(workItemId);
    const records = await this.#readContext(id);
    return requirementsFromContext(id, records);
  }

  async buildContextPackage(
    taskRequirements: TaskRequirements,
  ): Promise<WorkGraphContextPackage> {
    const task = TaskRequirementsSchema.parse(taskRequirements);
    const workItemId = task.taskId;
    const [workItem, records, dependenciesResponse, notesResponse] =
      await Promise.all([
        this.#read(
          "read work item",
          () => this.#client.getWorkItem(workItemId),
          WorkItemResponseSchema,
        ),
        this.#readContext(workItemId),
        this.#read(
          "read dependencies",
          () =>
            this.#client.listWorkItemDependencies(workItemId, {
              limit: this.#options.maxDependencies + 1,
            }),
          DependencyResponseSchema,
        ),
        this.#read(
          "read notes",
          () =>
            this.#client.listWorkItemNotes(workItemId, {
              limit: this.#options.maxNotes + 1,
            }),
          NoteResponseSchema,
        ),
      ]);

    this.#assertPageBound(
      workItemId,
      "dependencies",
      dependenciesResponse.items.length,
      dependenciesResponse.nextCursor,
      this.#options.maxDependencies,
    );
    this.#assertPageBound(
      workItemId,
      "notes",
      notesResponse.items.length,
      notesResponse.nextCursor,
      this.#options.maxNotes,
    );

    const requirements = requirementsFromContext(workItemId, records);
    const architectureDecisions = uniqueByUrl(
      workItemId,
      records.filter(
        (record): record is WorkGraphArchitectureDecision =>
          record.kind === "architecture_decision",
      ),
    ).sort(
      (left, right) =>
        (left.role === right.role ? 0 : left.role === "governing" ? -1 : 1) ||
        left.inheritanceDepth - right.inheritanceDepth ||
        compareIdentifiers(left.sourceWorkItemId, right.sourceWorkItemId) ||
        compareStrings(left.url, right.url),
    );
    const references = uniqueByUrl(
      workItemId,
      records.filter(
        (record): record is WorkGraphReference => record.kind === "reference",
      ),
    ).sort(
      (left, right) =>
        left.inheritanceDepth - right.inheritanceDepth ||
        compareIdentifiers(left.sourceWorkItemId, right.sourceWorkItemId) ||
        compareStrings(left.url, right.url),
    );
    const dependencies = [...dependenciesResponse.items].sort(
      (left, right) =>
        compareIdentifiers(
          left.dependentWorkItemId,
          right.dependentWorkItemId,
        ) || compareIdentifiers(left.blockerWorkItemId, right.blockerWorkItemId),
    );
    const notes = [...notesResponse.items].sort(
      (left, right) =>
        compareStrings(left.createdAt, right.createdAt) ||
        compareStrings(left.id, right.id),
    );
    const requiredEvidence = [...task.requiredEvidence].sort(
      (left, right) =>
        evidenceStageRank[left.stage] - evidenceStageRank[right.stage] ||
        compareIdentifiers(left.kind, right.kind),
    );
    const contextPackage = WorkGraphContextPackageSchema.parse({
      schemaVersion: 1,
      workItem,
      taskRequirements: task,
      brief: requirements.brief,
      acceptanceCriteria: requirements.acceptanceCriteria,
      dependencies,
      architectureDecisions,
      references,
      notes,
      requiredEvidence,
    });
    const packageBytes = new TextEncoder().encode(
      JSON.stringify(contextPackage),
    ).byteLength;
    if (packageBytes > this.#options.maxPackageBytes) {
      throw new WorkGraphIntegrationError(
        "context_limit_exceeded",
        `The context package for ${workItemId} is ${packageBytes} bytes; the limit is ${this.#options.maxPackageBytes}. Split or trim the work context before routing it.`,
        { details: { packageBytes, limit: this.#options.maxPackageBytes } },
      );
    }
    return contextPackage;
  }

  async claim(
    taskRequirements: TaskRequirements,
    input: { workerId: string; leaseDurationSeconds: number },
  ): Promise<ClaimedWork> {
    const task = TaskRequirementsSchema.parse(taskRequirements);
    const workerId = IdentifierSchema.parse(input.workerId);
    const leaseDurationSeconds = LeaseDurationSecondsSchema.parse(
      input.leaseDurationSeconds,
    );
    const context = await this.buildContextPackage(task);
    const claimed = await this.#mutate(
      "claim work",
      () =>
        this.#client.claim({
          workItemId: task.taskId,
          workerId,
          leaseDurationSeconds,
        }),
      ClaimResponseSchema,
      "claim_conflict",
      `Work item ${task.taskId} is no longer claimable. Refresh ready work before choosing another item.`,
    );
    if (
      claimed.workItem.id !== task.taskId ||
      claimed.lease.workItemId !== task.taskId ||
      claimed.lease.workerId !== workerId
    ) {
      throw new WorkGraphIntegrationError(
        "work_item_mismatch",
        `Work Graph claimed a different work item or worker than requested for ${task.taskId}. Inspect the active lease before retrying.`,
        { details: { lease: claimed.lease } },
      );
    }
    return ClaimedWorkSchema.parse({
      lease: claimed.lease,
      workItem: claimed.workItem,
      context: { ...context, workItem: claimed.workItem },
    });
  }

  async renew(
    handleInput: LeaseHandle,
    leaseDurationSecondsInput: number,
  ): Promise<WorkGraphLease> {
    const handle = this.#activeHandle(handleInput);
    const leaseDurationSeconds = LeaseDurationSecondsSchema.parse(
      leaseDurationSecondsInput,
    );
    const response = await this.#mutateLease(
      "renew lease",
      handle,
      () =>
        this.#client.renew(handle.id, {
          epoch: handle.epoch,
          leaseDurationSeconds,
        }),
      LeaseResponseSchema,
    );
    this.#assertLeaseIdentity(handle, response.lease);
    return response.lease;
  }

  async checkpoint(
    handleInput: LeaseHandle,
    contentInput: string,
    input: { noteId?: string; renewForSeconds?: number } = {},
  ): Promise<CheckpointResult> {
    const handle = this.#activeHandle(handleInput);
    const content = z.string().trim().min(1).max(10_000).parse(contentInput);
    const noteId = z.uuid().parse(input.noteId ?? this.#options.createId());
    const note = await this.#mutateLease(
      "checkpoint work",
      handle,
      () =>
        this.#client.createNote(
          handle.workItemId,
          {
            id: noteId,
            leaseId: handle.id,
            epoch: handle.epoch,
            content,
          },
          noteId,
        ),
      NoteMutationResponseSchema,
    );
    const lease =
      input.renewForSeconds === undefined
        ? handle
        : await this.renew(handle, input.renewForSeconds);
    return CheckpointResultSchema.parse({ note, lease });
  }

  async release(
    handleInput: LeaseHandle,
    evidence: { mergeEvidence: string; deploymentEvidence: string },
  ): Promise<{ lease: WorkGraphLease; workItem: WorkGraphWorkItem }> {
    const handle = this.#activeHandle(handleInput);
    const parsedEvidence = z
      .object({
        mergeEvidence: z.string().trim().min(1),
        deploymentEvidence: z.string().trim().min(1),
      })
      .strict()
      .parse(evidence);
    const response = await this.#mutateLease(
      "release work",
      handle,
      () =>
        this.#client.release(handle.workItemId, {
          leaseId: handle.id,
          epoch: handle.epoch,
          ...parsedEvidence,
        }),
      ReleaseResponseSchema,
    );
    this.#assertLeaseIdentity(handle, response.lease);
    if (
      response.lease.outcome !== "released" ||
      response.workItem.lifecycle !== "released"
    ) {
      throw new WorkGraphIntegrationError(
        "invalid_response",
        `Work Graph did not confirm release of ${handle.workItemId}. Inspect the item before retrying.`,
      );
    }
    return response;
  }

  async observeLease(handleInput: LeaseHandle): Promise<LeaseObservation> {
    const handle = LeaseHandleSchema.parse(handleInput);
    const query = {
      limit: 2,
      ...(handle.epoch > 1 ? { afterEpoch: handle.epoch - 1 } : {}),
    };
    const [workItem, leasesResponse] = await Promise.all([
      this.#read(
        "observe work item",
        () => this.#client.getWorkItem(handle.workItemId),
        WorkItemResponseSchema,
      ),
      this.#read(
        "observe lease",
        () => this.#client.listWorkItemLeases(handle.workItemId, query),
        LeaseListResponseSchema,
      ),
    ]);
    const lease = leasesResponse.items.find(
      (candidate) =>
        candidate.id === handle.id && candidate.epoch === handle.epoch,
    );
    if (!lease) {
      throw new WorkGraphIntegrationError(
        "lease_not_found",
        `Work Graph has no lease ${handle.id} at epoch ${handle.epoch} for ${handle.workItemId}. Refresh the claim record.`,
      );
    }
    const currentLease = workItem.currentLease;
    const superseded =
      currentLease !== null &&
      (currentLease.id !== handle.id || currentLease.epoch !== handle.epoch);
    const status = superseded
      ? "superseded"
      : lease.endedAt !== null
        ? lease.outcome === "expired"
          ? "expired"
          : "ended"
        : Date.parse(lease.expiresAt) <= this.#options.now()
          ? "expired"
          : "active";
    return LeaseObservationSchema.parse({
      status,
      lease,
      workItem,
    });
  }

  async #readContext(workItemId: string): Promise<ResolvedContext[]> {
    const response = await this.#read(
      "read context",
      () => this.#client.listWorkItemContexts(workItemId),
      ContextResponseSchema,
    );
    if (response.items.length > this.#options.maxContextRecords) {
      throw new WorkGraphIntegrationError(
        "context_limit_exceeded",
        `Work item ${workItemId} has ${response.items.length} resolved context records; the limit is ${this.#options.maxContextRecords}. Split or trim the context before routing it.`,
      );
    }
    return response.items;
  }

  #assertPageBound(
    workItemId: string,
    kind: string,
    count: number,
    nextCursor: unknown,
    limit: number,
  ): void {
    if (count <= limit && nextCursor === null) return;
    throw new WorkGraphIntegrationError(
      "context_limit_exceeded",
      `Work item ${workItemId} has more than ${limit} ${kind}. Archive or summarize them before routing the work.`,
      { details: { kind, limit } },
    );
  }

  #activeHandle(handleInput: LeaseHandle): LeaseHandle {
    const handle = LeaseHandleSchema.parse(handleInput);
    if (Date.parse(handle.expiresAt) <= this.#options.now()) {
      throw new WorkGraphIntegrationError(
        "lease_expired",
        `Lease ${handle.id} for ${handle.workItemId} expired at ${handle.expiresAt}. Observe the item and claim a new lease before mutating it.`,
      );
    }
    return handle;
  }

  #assertLeaseIdentity(
    handle: LeaseHandle,
    lease: WorkGraphLease,
  ): void {
    if (
      lease.id === handle.id &&
      lease.epoch === handle.epoch &&
      lease.workItemId === handle.workItemId &&
      lease.workerId === handle.workerId
    ) {
      return;
    }
    throw new WorkGraphIntegrationError(
      "stale_lease",
      `Work Graph returned a different lease while mutating ${handle.workItemId}. Stop work and refresh the claim.`,
      { details: { expected: handle, actual: lease } },
    );
  }

  async #read<Output>(
    label: string,
    action: () => Promise<unknown>,
    schema: z.ZodType<Output>,
  ): Promise<Output> {
    try {
      const result = await action();
      const parsed = schema.safeParse(result);
      if (!parsed.success) {
        throw new WorkGraphIntegrationError(
          "invalid_response",
          `Work Graph returned an invalid response while trying to ${label}.`,
          { details: z.treeifyError(parsed.error) },
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof WorkGraphIntegrationError) throw error;
      const status = statusOfError(error);
      if (status === 404) {
        throw new WorkGraphIntegrationError(
          "work_item_not_found",
          `Work Graph could not find the requested work while trying to ${label}. Refresh ready work.`,
          { cause: error },
        );
      }
      throw new WorkGraphIntegrationError(
        "integration_unavailable",
        `Could not ${label} through Work Graph. Retry after checking the Work Graph connection.`,
        { cause: error },
      );
    }
  }

  async #mutate<Output>(
    label: string,
    action: () => Promise<unknown>,
    schema: z.ZodType<Output>,
    conflictCode: WorkGraphIntegrationErrorCode,
    conflictMessage: string,
  ): Promise<Output> {
    try {
      return await this.#read(label, action, schema);
    } catch (error) {
      if (
        error instanceof WorkGraphIntegrationError &&
        error.code === "integration_unavailable" &&
        statusOfError(error.cause) === 409
      ) {
        throw new WorkGraphIntegrationError(conflictCode, conflictMessage, {
          cause: error.cause,
        });
      }
      throw error;
    }
  }

  #mutateLease<Output>(
    label: string,
    handle: LeaseHandle,
    action: () => Promise<unknown>,
    schema: z.ZodType<Output>,
  ): Promise<Output> {
    return this.#mutate(
      label,
      action,
      schema,
      "stale_lease",
      `Lease ${handle.id} at epoch ${handle.epoch} no longer owns ${handle.workItemId}. Stop work, observe the lease, and claim again if the item is ready.`,
    );
  }
}
