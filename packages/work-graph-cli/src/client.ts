import { createClient } from "./generated/client/client/index.js";
import type { Client } from "./generated/client/client/index.js";
import {
  archiveKnowledgeScope,
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
  getCriticalPath,
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
  restoreKnowledgeScope,
  unexpediteWorkItem,
} from "./generated/client/sdk.gen.js";
import type {
  ArchiveKnowledgeScopeData,
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
  GetCriticalPathData,
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

const RETRYABLE_API_ERROR_CODES = new Set([
  "database_capacity",
  "database_timeout",
  "database_unavailable",
]);
const SAFE_RETRY_METHODS = new Set(["GET", "HEAD"]);

type Sleep = (delayMs: number, signal: AbortSignal) => Promise<void>;

export interface WorkGraphClientOptions {
  readonly initialBackoffMs?: number;
  readonly maxAttempts?: number;
  readonly maxBackoffMs?: number;
  readonly maxElapsedMs?: number;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly requestTimeoutMs?: number;
  readonly sleep?: Sleep;
}

interface ResolvedRetryPolicy {
  initialBackoffMs: number;
  maxAttempts: number;
  maxBackoffMs: number;
  maxElapsedMs: number;
  now: () => number;
  random: () => number;
  requestTimeoutMs: number;
  sleep: Sleep;
}

const sleep: Sleep = (delayMs, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const resolveRetryPolicy = (
  options: WorkGraphClientOptions,
): ResolvedRetryPolicy => ({
  initialBackoffMs: options.initialBackoffMs ?? 250,
  maxAttempts: options.maxAttempts ?? 3,
  maxBackoffMs: options.maxBackoffMs ?? 4_000,
  maxElapsedMs: options.maxElapsedMs ?? 30_000,
  now: options.now ?? Date.now,
  random: options.random ?? Math.random,
  requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
  sleep: options.sleep ?? sleep,
});

const isApiError = (
  value: unknown,
): value is {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
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
    typeof error.message === "string" &&
    (!("requestId" in error) || typeof error.requestId === "string")
  );
};

const requestCanBeRetried = (request: Request): boolean =>
  SAFE_RETRY_METHODS.has(request.method.toUpperCase()) ||
  request.headers.has("idempotency-key");

const retryableResponse = async (response: Response): Promise<boolean> => {
  if (response.status !== 503) return false;
  try {
    const body: unknown = await response.clone().json();
    return isApiError(body) && RETRYABLE_API_ERROR_CODES.has(body.error.code);
  } catch {
    return false;
  }
};

const retryAfterMilliseconds = (response: Response): number => {
  const value = response.headers.get("retry-after");
  if (value === null || !/^\d+$/u.test(value)) return 0;
  return Number.parseInt(value, 10) * 1_000;
};

const retryDelay = (
  response: Response,
  retryNumber: number,
  policy: ResolvedRetryPolicy,
): number => {
  const backoff = Math.min(
    policy.maxBackoffMs,
    policy.initialBackoffMs * 2 ** (retryNumber - 1),
  );
  return retryAfterMilliseconds(response) + Math.floor(policy.random() * backoff);
};

const fetchAttempt = async (
  fetchImplementation: Fetch,
  request: Request,
  lastRetryableResponse: Response | undefined,
): Promise<{ response: Response; retryFailed: boolean }> => {
  try {
    return {
      response: await fetchImplementation(request.clone()),
      retryFailed: false,
    };
  } catch (error) {
    if (lastRetryableResponse !== undefined) {
      return { response: lastRetryableResponse, retryFailed: true };
    }
    throw error;
  }
};

const waitBeforeRetry = async (
  response: Response,
  retryNumber: number,
  startedAt: number,
  requestSignal: AbortSignal,
  policy: ResolvedRetryPolicy,
): Promise<boolean> => {
  const delayMs = retryDelay(response, retryNumber, policy);
  const elapsedMs = policy.now() - startedAt;
  if (elapsedMs + delayMs >= policy.maxElapsedMs) return false;
  try {
    await policy.sleep(delayMs, requestSignal);
    return true;
  } catch (error) {
    if (requestSignal.aborted) return false;
    throw error;
  }
};

const idempotencyHeaders = (
  idempotencyKey: string | undefined,
): { "idempotency-key": string } => ({
  "idempotency-key": idempotencyKey ?? crypto.randomUUID(),
});

export class WorkGraphClient {
  readonly #apiOrigin: string;
  readonly #client: Client;
  readonly #fetchImplementation: Fetch;
  readonly #retryPolicy: ResolvedRetryPolicy;

  constructor(
    config: WorkGraphClientConfig,
    fetchImplementation: Fetch = fetch,
    options: WorkGraphClientOptions = {},
  ) {
    this.#apiOrigin = config.apiUrl.origin;
    this.#fetchImplementation = fetchImplementation;
    this.#retryPolicy = resolveRetryPolicy(options);
    this.#client = createClient({
      baseUrl: config.apiUrl.href,
      fetch: (input, init) => this.#fetchWithRetry(input, init),
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
      signal: AbortSignal.timeout(this.#retryPolicy.requestTimeoutMs),
    };
  }

  async #fetchWithRetry(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init);
    const canRetry = requestCanBeRetried(request);
    const startedAt = this.#retryPolicy.now();
    let lastRetryableResponse: Response | undefined;

    for (let attempt = 1; attempt <= this.#retryPolicy.maxAttempts; attempt += 1) {
      const { response, retryFailed } = await fetchAttempt(
        this.#fetchImplementation,
        request,
        lastRetryableResponse,
      );
      if (retryFailed) return response;
      if (!canRetry || !(await retryableResponse(response))) return response;

      lastRetryableResponse = response;
      if (attempt === this.#retryPolicy.maxAttempts) return response;
      const shouldRetry = await waitBeforeRetry(
        response,
        attempt,
        startedAt,
        request.signal,
        this.#retryPolicy,
      );
      if (!shouldRetry) return response;
    }

    throw new Error("The Work Graph retry loop ended without a response.");
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
      {
        details: serverError?.details,
        requestId:
          serverError?.requestId ??
          result.response?.headers.get("x-request-id") ??
          undefined,
        status,
      },
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

  getCriticalPath(query: NonNullable<GetCriticalPathData["query"]>) {
    return this.#unwrap(getCriticalPath({ ...this.#options(), query }));
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

  archiveKnowledgeScope(
    knowledgeScopeId: string,
    body: ArchiveKnowledgeScopeData["body"],
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      archiveKnowledgeScope({
        ...this.#options(),
        body,
        headers: idempotencyHeaders(idempotencyKey),
        path: { knowledgeScopeId },
      }),
    );
  }

  restoreKnowledgeScope(
    knowledgeScopeId: string,
    idempotencyKey?: string,
  ) {
    return this.#unwrap(
      restoreKnowledgeScope({
        ...this.#options(),
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
