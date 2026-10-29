import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TEXT_LENGTH = 10_000;
const MAX_LEASE_DURATION_SECONDS = 86_400;
const DEFAULT_LIST_LIMIT = 50;

const identifierSchema = z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH);
const uuidSchema = z.uuid().max(36);
const epochSchema = z.number().int().min(1).max(2_147_483_647);
const leaseDurationSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LEASE_DURATION_SECONDS);
const limitSchema = z.number().int().min(1).max(100).default(DEFAULT_LIST_LIMIT);
const optionalIdempotencyKeySchema = uuidSchema.optional().describe(
  "Stable client-generated mutation ID. Reuse it only for an identical request.",
);
const selectionShape = {
  includeInitiativeIds: z.array(identifierSchema).max(100).optional(),
  excludeInitiativeIds: z.array(identifierSchema).max(100).optional(),
  includeProjectIds: z.array(identifierSchema).max(100).optional(),
  excludeProjectIds: z.array(identifierSchema).max(100).optional(),
  includeParentTitles: z
    .array(z.string().trim().min(1).max(MAX_TEXT_LENGTH))
    .max(100)
    .optional(),
  excludeParentTitles: z
    .array(z.string().trim().min(1).max(MAX_TEXT_LENGTH))
    .max(100)
    .optional(),
};

const queueInputSchema = z.object({
  ...selectionShape,
  parentId: identifierSchema.optional(),
  stage: z
    .enum([
      "blocked",
      "ready",
      "in_progress",
      "stale",
      "needs_attention",
      "released",
      "cancelled",
    ])
    .default("ready"),
  cursor: identifierSchema.optional(),
  limit: limitSchema,
});
const ticketInputSchema = z.object({ workItemId: identifierSchema });
const criticalPathInputSchema = z
  .object({
    ...selectionShape,
    rootWorkItemId: identifierSchema.optional(),
  })
  .refine(
    ({ rootWorkItemId, ...selection }) =>
      rootWorkItemId === undefined ||
      Object.values(selection).every((value) => value === undefined),
    {
      message:
        "rootWorkItemId cannot be combined with inclusion or exclusion filters.",
    },
  );
const claimInputSchema = z.union([
  z.object({
    workItemId: identifierSchema,
    workerId: identifierSchema,
    leaseDurationSeconds: leaseDurationSchema.default(900),
  }),
  z.object({
    ...selectionShape,
    parentId: identifierSchema.optional(),
    workerId: identifierSchema,
    leaseDurationSeconds: leaseDurationSchema.default(900),
  }),
]);
const noteInputSchema = z.object({
  workItemId: identifierSchema,
  leaseId: uuidSchema,
  epoch: epochSchema,
  content: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  id: uuidSchema.optional(),
  idempotencyKey: optionalIdempotencyKeySchema,
});
const renewInputSchema = z.object({
  leaseId: uuidSchema,
  epoch: epochSchema,
  leaseDurationSeconds: leaseDurationSchema.default(900),
});
const releaseInputSchema = z.object({
  workItemId: identifierSchema,
  leaseId: uuidSchema,
  epoch: epochSchema,
  mergeEvidence: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  deploymentEvidence: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
});
const cancelInputSchema = z.object({
  workItemId: identifierSchema,
  leaseId: uuidSchema,
  epoch: epochSchema,
});
const dependencySchema = z.object({
  dependentWorkItemId: identifierSchema,
  blockerWorkItemId: identifierSchema,
});
const decomposeInputSchema = z.object({
  workItemId: identifierSchema,
  leaseId: uuidSchema,
  epoch: epochSchema,
  children: z
    .array(
      z.object({
        id: identifierSchema,
        title: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
        rank: z.number().int().min(1).max(2_147_483_647),
      }),
    )
    .min(1)
    .max(100),
  dependencies: z.array(dependencySchema).max(1_000).optional(),
  claim: z
    .object({
      workItemId: identifierSchema,
      leaseId: uuidSchema,
      leaseDurationSeconds: leaseDurationSchema,
    })
    .optional(),
  idempotencyKey: optionalIdempotencyKeySchema,
});
const contextInputSchema = z.intersection(
  z.object({
    workItemId: identifierSchema,
    idempotencyKey: optionalIdempotencyKeySchema,
  }),
  z.union([
    z.object({
      kind: z.enum(["brief", "acceptance_criteria"]),
      content: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    }),
    z.object({
      kind: z.literal("architecture_decision"),
      title: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
      url: z.url().max(2_048),
      role: z.enum(["governing", "background"]),
    }),
  ]),
);
const attentionListInputSchema = z.object({
  workItemId: identifierSchema.optional(),
  state: z.enum(["unresolved", "resolved", "all"]).default("unresolved"),
  blocking: z.boolean().optional(),
  cursor: uuidSchema.optional(),
  limit: limitSchema,
});
const attentionRequestInputSchema = z.object({
  workItemId: identifierSchema,
  leaseId: uuidSchema,
  epoch: epochSchema,
  kind: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  note: z.string().trim().min(1).max(MAX_TEXT_LENGTH).optional(),
  blocking: z.boolean().default(true),
  id: uuidSchema.optional(),
  idempotencyKey: optionalIdempotencyKeySchema,
});
const attentionResolutionInputSchema = z.object({
  attentionRequestId: uuidSchema,
  resolution: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  id: uuidSchema.optional(),
  idempotencyKey: optionalIdempotencyKeySchema,
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;
const replayCapableMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations;
const fencedMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations;

export type WorkGraphApplicationFetch = (
  request: Request,
) => Response | Promise<Response>;

const applicationUrl = (path: string): URL =>
  new URL(path, "https://work-graph.application.internal");

const appendQuery = (
  url: URL,
  values: Readonly<Record<string, unknown>>,
): void => {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, String(item));
      continue;
    }
    url.searchParams.set(name, String(value));
  }
};

const toolResult = async (response: Response): Promise<CallToolResult> => {
  const raw = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = {
      error: {
        code: "invalid_application_response",
        message: "The Work Graph application returned a non-JSON response.",
      },
    };
  }
  const text = JSON.stringify(value);
  return {
    content: [{ type: "text", text }],
    ...(typeof value === "object" && value !== null && !Array.isArray(value)
      ? { structuredContent: value as Record<string, unknown> }
      : {}),
    ...(response.ok ? {} : { isError: true }),
  };
};

const callApplication = async (
  applicationFetch: WorkGraphApplicationFetch,
  path: string,
  options: {
    body?: unknown;
    idempotencyKey?: string;
    method?: "DELETE" | "GET" | "POST" | "PUT";
    query?: Readonly<Record<string, unknown>>;
    signal?: AbortSignal;
  } = {},
): Promise<CallToolResult> => {
  const url = applicationUrl(path);
  if (options.query !== undefined) appendQuery(url, options.query);
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey !== undefined) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  return toolResult(
    await applicationFetch(
      new Request(url, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    ),
  );
};

const pathIdentifier = (value: string): string => encodeURIComponent(value);
const mutationKey = (provided: string | undefined): string =>
  provided ?? crypto.randomUUID();
const mutationId = (provided: string | undefined): string =>
  provided ?? crypto.randomUUID();

export const createWorkGraphMcpServer = (
  applicationFetch: WorkGraphApplicationFetch,
): McpServer => {
  const server = new McpServer(
    { name: "work-graph", version: "0.1.0" },
    {
      instructions:
        "Use Work Graph as the authoritative coordination service. Preserve lease IDs and epochs from claim responses for every fenced update. Follow nextCursor until null when a complete listing is required.",
      maxToolInputElements: 2_000,
    },
  );

  server.registerTool(
    "queue",
    {
      description:
        "List one bounded Work Graph queue page in canonical priority order. Defaults to ready work.",
      inputSchema: queueInputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input, extra) =>
      callApplication(applicationFetch, "/api/work-items", {
        query: input,
        signal: extra.signal,
      }),
  );
  server.registerTool(
    "show_ticket",
    {
      description:
        "Inspect one ticket, its current lease, delivery evidence, and completion candidate.",
      inputSchema: ticketInputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ workItemId }, extra) =>
      callApplication(
        applicationFetch,
        `/api/work-items/${pathIdentifier(workItemId)}/details`,
        { signal: extra.signal },
      ),
  );
  server.registerTool(
    "ticket_context",
    {
      description:
        "Read local and inherited ticket context in the same order returned by a claim.",
      inputSchema: ticketInputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ workItemId }, extra) =>
      callApplication(
        applicationFetch,
        `/api/work-items/${pathIdentifier(workItemId)}/contexts`,
        { signal: extra.signal },
      ),
  );
  server.registerTool(
    "put_context",
    {
      description:
        "Create or replace ticket context through the canonical idempotent application operation.",
      inputSchema: contextInputSchema,
      annotations: replayCapableMutationAnnotations,
    },
    async (input, extra) => {
      const { idempotencyKey, workItemId, ...body } = input;
      return callApplication(
        applicationFetch,
        `/api/work-items/${pathIdentifier(workItemId)}/contexts`,
        {
          method: "PUT",
          body,
          idempotencyKey: mutationKey(idempotencyKey),
          signal: extra.signal,
        },
      );
    },
  );
  server.registerTool(
    "claim_ticket",
    {
      description:
        "Atomically claim an explicit ticket or the highest-priority never-started ready ticket in a scope. Claims are never retried.",
      inputSchema: claimInputSchema,
      annotations: fencedMutationAnnotations,
    },
    async (input, extra) =>
      callApplication(applicationFetch, "/api/leases", {
        method: "POST",
        body: input,
        signal: extra.signal,
      }),
  );
  server.registerTool(
    "add_note",
    {
      description:
        "Record an immutable progress note when the supplied lease ID and epoch still own the ticket.",
      inputSchema: noteInputSchema,
      annotations: replayCapableMutationAnnotations,
    },
    async (input, extra) => {
      const { id, idempotencyKey, workItemId, ...fencedNote } = input;
      return callApplication(
        applicationFetch,
        `/api/work-items/${pathIdentifier(workItemId)}/notes`,
        {
          method: "POST",
          body: { id: mutationId(id), ...fencedNote },
          idempotencyKey: mutationKey(idempotencyKey),
          signal: extra.signal,
        },
      );
    },
  );
  server.registerTool(
    "renew_lease",
    {
      description:
        "Extend a current lease at its fenced epoch. This operation is not replayed.",
      inputSchema: renewInputSchema,
      annotations: fencedMutationAnnotations,
    },
    async ({ leaseId, ...body }, extra) =>
      callApplication(
        applicationFetch,
        `/api/leases/${pathIdentifier(leaseId)}/renewals`,
        { method: "POST", body, signal: extra.signal },
      ),
  );
  server.registerTool(
    "decompose_ticket",
    {
      description:
        "Atomically create ranked child work, add dependency edges, end the parent lease, and optionally claim one child.",
      inputSchema: decomposeInputSchema,
      annotations: replayCapableMutationAnnotations,
    },
    async (input, extra) => {
      const { idempotencyKey, workItemId, ...body } = input;
      return callApplication(
        applicationFetch,
        `/api/work-items/${pathIdentifier(workItemId)}/decompositions`,
        {
          method: "POST",
          body,
          idempotencyKey: mutationKey(idempotencyKey),
          signal: extra.signal,
        },
      );
    },
  );
  server.registerTool(
    "release_ticket",
    {
      description:
        "Complete claimed work only after merge and deployment evidence exists.",
      inputSchema: releaseInputSchema,
      annotations: fencedMutationAnnotations,
    },
    async ({ workItemId, ...body }, extra) =>
      callApplication(
        applicationFetch,
        `/api/work-items/${pathIdentifier(workItemId)}/releases`,
        { method: "POST", body, signal: extra.signal },
      ),
  );
  server.registerTool(
    "cancel_ticket",
    {
      description:
        "Cancel an outcome that is no longer wanted and end its current fenced lease.",
      inputSchema: cancelInputSchema,
      annotations: fencedMutationAnnotations,
    },
    async ({ workItemId, ...body }, extra) =>
      callApplication(
        applicationFetch,
        `/api/work-items/${pathIdentifier(workItemId)}/cancellations`,
        { method: "POST", body, signal: extra.signal },
      ),
  );
  server.registerTool(
    "list_attention",
    {
      description:
        "List one bounded page of unresolved, resolved, or all attention requests.",
      inputSchema: attentionListInputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input, extra) =>
      callApplication(applicationFetch, "/api/attention-requests", {
        query: input,
        signal: extra.signal,
      }),
  );
  server.registerTool(
    "request_attention",
    {
      description:
        "Record a fenced attention request. A blocking request atomically ends the current lease.",
      inputSchema: attentionRequestInputSchema,
      annotations: replayCapableMutationAnnotations,
    },
    async (input, extra) => {
      const { id, idempotencyKey, ...body } = input;
      return callApplication(applicationFetch, "/api/attention-requests", {
        method: "POST",
        body: { id: mutationId(id), ...body },
        idempotencyKey: mutationKey(idempotencyKey),
        signal: extra.signal,
      });
    },
  );
  server.registerTool(
    "resolve_attention",
    {
      description:
        "Resolve one attention request and return the ticket's newly derived stage.",
      inputSchema: attentionResolutionInputSchema,
      annotations: replayCapableMutationAnnotations,
    },
    async (input, extra) => {
      const { attentionRequestId, id, idempotencyKey, resolution } = input;
      return callApplication(
        applicationFetch,
        `/api/attention-requests/${pathIdentifier(attentionRequestId)}/resolutions`,
        {
          method: "POST",
          body: { id: mutationId(id), resolution },
          idempotencyKey: mutationKey(idempotencyKey),
          signal: extra.signal,
        },
      );
    },
  );
  server.registerTool(
    "critical_path",
    {
      description:
        "Project delivery-critical outcomes, blockers, ready leaves, attention, and parallel claimable branches.",
      inputSchema: criticalPathInputSchema,
      annotations: readOnlyAnnotations,
    },
    async (input, extra) =>
      callApplication(applicationFetch, "/api/critical-path", {
        query: input,
        signal: extra.signal,
      }),
  );

  return server;
};

export const handleWorkGraphMcpRequest = async (
  request: Request,
  applicationFetch: WorkGraphApplicationFetch,
): Promise<Response> => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    maxRequestBodySize: 1_048_576,
  });
  const server = createWorkGraphMcpServer(applicationFetch);
  await server.connect(transport);
  return transport.handleRequest(request);
};
