import { createClient } from "./generated/client/client/index.js";
import type { Client } from "./generated/client/client/index.js";
import {
  createAttentionRequest,
  createAttentionResolution,
  createDependency,
  createKnowledgeScopeRelationship,
  createLease,
  createLeaseRenewal,
  createPostReleaseWorkItemNote,
  createWorkItem,
  createWorkItemCancellation,
  createWorkItemDecomposition,
  createWorkItemNote,
  createWorkItemRelease,
  deleteDependency,
  deleteKnowledgeScopeRelationship,
  expediteWorkItem,
  getKnowledgeScope,
  getWorkItem,
  listAttentionRequests,
  listKnowledgeScopeRelationships,
  listKnowledgeScopes,
  listWorkItemDependencies,
  listWorkItemContexts,
  listWorkItemEvents,
  listWorkItemLeases,
  listWorkItemNotes,
  listWorkItemPullRequests,
  listWorkItems,
  moveKnowledgeScopePriority,
  moveWorkItemPriority,
  putKnowledgeScope,
  putWorkItemPullRequest,
  putWorkItemContext,
  putWorkItemParent,
  putWorkItemReference,
  putWorkItemSchedulingScope,
  refreshPullRequest,
  unexpediteWorkItem,
} from "./generated/client/sdk.gen.js";
import type {
  CreateAttentionRequestData,
  CreateAttentionResolutionData,
  CreateDependencyData,
  CreateKnowledgeScopeRelationshipData,
  CreateLeaseData,
  CreateLeaseRenewalData,
  CreatePostReleaseWorkItemNoteData,
  CreateWorkItemCancellationData,
  CreateWorkItemData,
  CreateWorkItemDecompositionData,
  CreateWorkItemNoteData,
  CreateWorkItemReleaseData,
  DeleteDependencyData,
  DeleteKnowledgeScopeRelationshipData,
  ExpediteWorkItemData,
  ListAttentionRequestsData,
  ListKnowledgeScopeRelationshipsData,
  ListKnowledgeScopesData,
  ListWorkItemDependenciesData,
  ListWorkItemEventsData,
  ListWorkItemLeasesData,
  ListWorkItemNotesData,
  ListWorkItemsData,
  MoveKnowledgeScopePriorityData,
  MoveWorkItemPriorityData,
  PutKnowledgeScopeData,
  PutWorkItemPullRequestData,
  PutWorkItemContextData,
  PutWorkItemParentData,
  PutWorkItemReferenceData,
  PutWorkItemSchedulingScopeData,
  RefreshPullRequestData,
} from "./generated/client/types.gen.js";
import type { WorkGraphClientConfig } from "./config.js";
import { CliError, EXIT_CODES, exitCodeForStatus } from "./errors.js";

export type Fetch = typeof fetch;

interface ApiResult<Data> {
  data?: Data;
  error?: unknown;
  response?: Response;
}

const isApiError = (
  value: unknown,
): value is {
  error: { code: string; message: string; details?: unknown };
} => {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const error = value.error;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
};

const idempotencyHeaders = (
  idempotencyKey: string | undefined,
): { "idempotency-key"?: string } =>
  idempotencyKey === undefined
    ? {}
    : { "idempotency-key": idempotencyKey };

export class WorkGraphClient {
  readonly #apiOrigin: string;
  readonly #client: Client;

  constructor(config: WorkGraphClientConfig, fetchImplementation: Fetch = fetch) {
    this.#apiOrigin = config.apiUrl.origin;
    this.#client = createClient({
      baseUrl: config.apiUrl.href,
      fetch: fetchImplementation,
      headers: {
        Accept: "application/json",
        ...config.accessHeaders,
      },
      parseAs: "json",
      redirect: "manual",
    });
  }

  #options(): { client: Client; signal: AbortSignal } {
    return {
      client: this.#client,
      signal: AbortSignal.timeout(30_000),
    };
  }

  async #unwrap<Data>(request: PromiseLike<ApiResult<Data>>): Promise<Data> {
    const result = await request;
    if (result.data !== undefined) return result.data;

    const status = result.response?.status;
    if (status !== undefined && status >= 300 && status < 400) {
      throw new CliError(
        "REDIRECT_REFUSED",
        "The Work Graph API returned a redirect. Refusing to forward Access credentials.",
        EXIT_CODES.transport,
        { status },
      );
    }

    if (status === undefined) {
      throw new CliError(
        "TRANSPORT_ERROR",
        `Could not reach the Work Graph API at ${this.#apiOrigin}.`,
        EXIT_CODES.transport,
        { cause: result.error },
      );
    }

    if (status >= 200 && status < 300) {
      throw new CliError(
        "INVALID_API_RESPONSE",
        "The Work Graph API returned a non-JSON response.",
        EXIT_CODES.transport,
        { cause: result.error, status },
      );
    }

    const serverError = isApiError(result.error)
      ? result.error.error
      : undefined;
    throw new CliError(
      serverError?.code ?? `HTTP_${status}`,
      serverError?.message ?? `The Work Graph API returned HTTP ${status}.`,
      exitCodeForStatus(status),
      { details: serverError?.details, status },
    );
  }

  createWorkItem(body: CreateWorkItemData["body"], idempotencyKey?: string) {
    return this.#unwrap(
      createWorkItem({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
      }),
    );
  }

  listKnowledgeScopes(query: NonNullable<ListKnowledgeScopesData["query"]>) {
    return this.#unwrap(listKnowledgeScopes({ ...this.#options(), query }));
  }

  getKnowledgeScope(knowledgeScopeId: string) {
    return this.#unwrap(
      getKnowledgeScope({
        ...this.#options(),
        path: { knowledgeScopeId },
      }),
    );
  }

  putKnowledgeScope(
    knowledgeScopeId: string,
    body: PutKnowledgeScopeData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      putKnowledgeScope({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { knowledgeScopeId },
      }),
    );
  }

  moveKnowledgeScopePriority(
    knowledgeScopeId: string,
    body: MoveKnowledgeScopePriorityData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      moveKnowledgeScopePriority({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { knowledgeScopeId },
      }),
    );
  }

  moveWorkItemPriority(
    workItemId: string,
    body: MoveWorkItemPriorityData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      moveWorkItemPriority({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  expediteWorkItem(
    workItemId: string,
    body: ExpediteWorkItemData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      expediteWorkItem({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  unexpediteWorkItem(
    workItemId: string,
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      unexpediteWorkItem({
        ...this.#options(),
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  listKnowledgeScopeRelationships(
    query: NonNullable<ListKnowledgeScopeRelationshipsData["query"]>,
  ) {
    return this.#unwrap(
      listKnowledgeScopeRelationships({ ...this.#options(), query }),
    );
  }

  addKnowledgeScopeRelationship(
    body: CreateKnowledgeScopeRelationshipData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      createKnowledgeScopeRelationship({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
      }),
    );
  }

  removeKnowledgeScopeRelationship(
    body: DeleteKnowledgeScopeRelationshipData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      deleteKnowledgeScopeRelationship({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
      }),
    );
  }

  addDependency(
    body: CreateDependencyData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      createDependency({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
      }),
    );
  }

  removeDependency(
    body: DeleteDependencyData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      deleteDependency({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
      }),
    );
  }

  listWorkItems(query: NonNullable<ListWorkItemsData["query"]>) {
    return this.#unwrap(listWorkItems({ ...this.#options(), query }));
  }

  getWorkItem(workItemId: string) {
    return this.#unwrap(
      getWorkItem({ ...this.#options(), path: { workItemId } }),
    );
  }

  putWorkItemParent(
    workItemId: string,
    body: PutWorkItemParentData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      putWorkItemParent({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  putWorkItemSchedulingScope(
    workItemId: string,
    body: PutWorkItemSchedulingScopeData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      putWorkItemSchedulingScope({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  listWorkItemContexts(workItemId: string) {
    return this.#unwrap(
      listWorkItemContexts({
        ...this.#options(),
        path: { workItemId },
      }),
    );
  }

  putWorkItemContext(
    workItemId: string,
    body: PutWorkItemContextData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      putWorkItemContext({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  putWorkItemReference(
    workItemId: string,
    body: PutWorkItemReferenceData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      putWorkItemReference({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  refreshPullRequest(
    body: RefreshPullRequestData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      refreshPullRequest({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
      }),
    );
  }

  listWorkItemPullRequests(workItemId: string) {
    return this.#unwrap(
      listWorkItemPullRequests({
        ...this.#options(),
        path: { workItemId },
      }),
    );
  }

  putWorkItemPullRequest(
    workItemId: string,
    body: PutWorkItemPullRequestData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      putWorkItemPullRequest({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  listWorkItemNotes(
    workItemId: string,
    query: NonNullable<ListWorkItemNotesData["query"]>,
  ) {
    return this.#unwrap(
      listWorkItemNotes({
        ...this.#options(),
        path: { workItemId },
        query,
      }),
    );
  }

  listWorkItemEvents(
    workItemId: string,
    query: NonNullable<ListWorkItemEventsData["query"]>,
  ) {
    return this.#unwrap(
      listWorkItemEvents({
        ...this.#options(),
        path: { workItemId },
        query,
      }),
    );
  }

  listWorkItemDependencies(
    workItemId: string,
    query: NonNullable<ListWorkItemDependenciesData["query"]>,
  ) {
    return this.#unwrap(
      listWorkItemDependencies({
        ...this.#options(),
        path: { workItemId },
        query,
      }),
    );
  }

  listWorkItemLeases(
    workItemId: string,
    query: NonNullable<ListWorkItemLeasesData["query"]>,
  ) {
    return this.#unwrap(
      listWorkItemLeases({
        ...this.#options(),
        path: { workItemId },
        query,
      }),
    );
  }

  claim(body: CreateLeaseData["body"]) {
    return this.#unwrap(createLease({ ...this.#options(), body }));
  }

  renew(leaseId: string, body: CreateLeaseRenewalData["body"]) {
    return this.#unwrap(
      createLeaseRenewal({ ...this.#options(), body, path: { leaseId } }),
    );
  }

  createNote(
    workItemId: string,
    body: CreateWorkItemNoteData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      createWorkItemNote({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  createPostReleaseNote(
    workItemId: string,
    body: CreatePostReleaseWorkItemNoteData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      createPostReleaseWorkItemNote({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  decompose(
    workItemId: string,
    body: CreateWorkItemDecompositionData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      createWorkItemDecomposition({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { workItemId },
      }),
    );
  }

  listAttention(query: NonNullable<ListAttentionRequestsData["query"]>) {
    return this.#unwrap(listAttentionRequests({ ...this.#options(), query }));
  }

  requestAttention(
    body: CreateAttentionRequestData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      createAttentionRequest({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
      }),
    );
  }

  resolveAttention(
    attentionRequestId: string,
    body: CreateAttentionResolutionData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      createAttentionResolution({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { attentionRequestId },
      }),
    );
  }

  release(workItemId: string, body: CreateWorkItemReleaseData["body"]) {
    return this.#unwrap(
      createWorkItemRelease({
        ...this.#options(),
        body,
        path: { workItemId },
      }),
    );
  }

  cancel(workItemId: string, body: CreateWorkItemCancellationData["body"]) {
    return this.#unwrap(
      createWorkItemCancellation({
        ...this.#options(),
        body,
        path: { workItemId },
      }),
    );
  }
}
