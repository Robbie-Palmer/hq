import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  CriticalPathProjection,
  WorkItem,
} from "work-graph-domain";
import type { WorkItemReadModel } from "work-graph-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkGraphApp,
  type WorkGraphApiRepository,
} from "../src/app";
import {
  handleWorkGraphMcpRequest,
  type WorkGraphApplicationFetch,
} from "../src/mcp";

const UUID = "00000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000002";
const MERGE_EVIDENCE = "https://github.com/example/work-graph/pull/1";
const DEPLOYMENT_EVIDENCE = "https://work-graph.example.test/health";
const storedItem: WorkItem = {
  id: "item-1",
  title: "Test the short agent workflow",
  lifecycle: "open",
  parentId: null,
  rank: null,
  priorityRank: 1,
  schedulingInitiativeId: "initiative",
  schedulingProjectId: "project",
  expedited: false,
  expediteReason: null,
};
const readyItem: WorkItemReadModel = {
  ...storedItem,
  priority: {
    initiativeRank: 1,
    projectRank: 1,
    ticketRank: 1,
    expedited: false,
    effectiveExpedited: false,
    donatedFromWorkItemId: null,
  },
  stage: "ready",
  currentLease: null,
};
const criticalPathProjection: CriticalPathProjection = {
  targetOutcomeIds: [storedItem.id],
  nodes: [
    {
      item: storedItem,
      stage: "ready",
      claimable: true,
      priority: readyItem.priority,
      inclusionReasons: [{ kind: "target_outcome" }],
    },
  ],
  edges: [],
  blockingPaths: [[storedItem.id]],
  readyLeafIds: [storedItem.id],
  blockingAttentionIds: [],
  parallelBranches: [
    {
      workItemId: storedItem.id,
      stage: "ready",
      claimable: true,
      targetWorkItemIds: [storedItem.id],
      paths: [[storedItem.id]],
    },
  ],
};

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
});

const protocolClient = async (
  applicationFetch: WorkGraphApplicationFetch,
  endpointFetch: typeof fetch = (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return handleWorkGraphMcpRequest(request, applicationFetch);
  },
): Promise<Client> => {
  const client = new Client({ name: "work-graph-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("https://work-graph.example.test/mcp"),
    { fetch: endpointFetch },
  );
  await client.connect(transport);
  clients.push(client);
  return client;
};

const resultJson = (result: CallToolResult): unknown => {
  const text = result.content.find(({ type }) => type === "text");
  if (text?.type !== "text") throw new Error("Tool result has no text content.");
  return JSON.parse(text.text);
};

describe("Given the Work Graph MCP protocol", () => {
  it("publishes bounded schemas and accurate tool annotations", async () => {
    const client = await protocolClient(async () =>
      Response.json({ error: { code: "unexpected_call", message: "Unexpected" } }, { status: 500 }),
    );

    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual([
      "queue",
      "show_ticket",
      "ticket_context",
      "put_context",
      "claim_ticket",
      "add_note",
      "renew_lease",
      "decompose_ticket",
      "release_ticket",
      "cancel_ticket",
      "list_attention",
      "request_attention",
      "resolve_attention",
      "critical_path",
    ]);
    const queue = tools.find(({ name }) => name === "queue");
    expect(queue?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        cursor: { type: "string" },
        limit: { default: 50, maximum: 100, minimum: 1, type: "integer" },
        stage: { default: "ready" },
      },
    });
    expect(queue?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    const note = tools.find(({ name }) => name === "add_note");
    expect(note?.inputSchema).toMatchObject({
      type: "object",
      required: ["workItemId", "leaseId", "epoch", "content"],
      properties: {
        epoch: { minimum: 1, type: "integer" },
        idempotencyKey: { format: "uuid", type: "string" },
        leaseId: { format: "uuid", type: "string" },
      },
    });
    expect(note?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(
      tools.find(({ name }) => name === "claim_ticket")?.annotations,
    ).toMatchObject({ destructiveHint: true, idempotentHint: false });
  });

  it("serves stateless Streamable HTTP from the Access-protected application path", async () => {
    const applicationFetch = vi.fn(async () => Response.json({ ok: true }));
    const app = createWorkGraphApp({} as WorkGraphApiRepository);
    const endpointFetch: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return app.request(request);
    };
    const client = await protocolClient(applicationFetch, endpointFetch);

    expect(client.getServerVersion()).toEqual({
      name: "work-graph",
      version: "0.1.0",
    });
    await expect(client.ping()).resolves.toEqual({});
    expect(applicationFetch).not.toHaveBeenCalled();

    const unsupported = await app.request("/mcp", { method: "PUT" });
    expect(unsupported.status).toBe(405);
  });
});

describe("Given the existing REST projections", () => {
  it("returns the same queue page and critical-path fixture through MCP", async () => {
    const repository = {
      listWorkItems: vi.fn(async () => [readyItem]),
      projectCriticalPath: vi.fn(async () => criticalPathProjection),
    } as unknown as WorkGraphApiRepository;
    const app = createWorkGraphApp(repository);
    const endpointFetch: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return app.request(request);
    };
    const client = await protocolClient((request) => app.request(request), endpointFetch);
    const restQueue = await (
      await app.request(
        "/api/work-items?stage=ready&limit=50&includeProjectIds=project",
      )
    ).json();
    const restCriticalPath = await (
      await app.request("/api/critical-path?includeProjectIds=project")
    ).json();

    const queue = await client.callTool({
      name: "queue",
      arguments: { includeProjectIds: ["project"] },
    });
    const criticalPath = await client.callTool({
      name: "critical_path",
      arguments: { includeProjectIds: ["project"] },
    });

    expect(queue.isError).not.toBe(true);
    expect(queue.structuredContent).toEqual(restQueue);
    expect(criticalPath.structuredContent).toEqual(restCriticalPath);
    expect(repository.listWorkItems).toHaveBeenCalledWith({
      includeProjectIds: ["project"],
    });
    expect(repository.projectCriticalPath).toHaveBeenCalledWith({
      includeProjectIds: ["project"],
    });
  });
});

describe("Given the existing CLI request fixtures", () => {
  it("maps claims, fenced updates, attention, and releases without changing their wire contract", async () => {
    const requests: Array<{
      body: unknown;
      headers: Headers;
      method: string;
      url: URL;
    }> = [];
    const applicationFetch: WorkGraphApplicationFetch = async (request) => {
      const raw = await request.clone().text();
      requests.push({
        body: raw === "" ? undefined : JSON.parse(raw),
        headers: request.headers,
        method: request.method,
        url: new URL(request.url),
      });
      return Response.json({ ok: true });
    };
    const client = await protocolClient(applicationFetch);

    await client.callTool({
      name: "claim_ticket",
      arguments: {
        workItemId: "work/a b",
        workerId: "agent-a",
        leaseDurationSeconds: 120,
      },
    });
    await client.callTool({
      name: "add_note",
      arguments: {
        workItemId: "item-1",
        leaseId: UUID,
        epoch: 2,
        content: "Tests pass",
        id: UUID,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
    await client.callTool({
      name: "request_attention",
      arguments: {
        workItemId: "item-1",
        leaseId: UUID,
        epoch: 5,
        kind: "decision",
        question: "Which host?",
        blocking: false,
        id: UUID,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
    await client.callTool({
      name: "resolve_attention",
      arguments: {
        attentionRequestId: UUID,
        resolution: "Use the Worker",
        id: UUID,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
    await client.callTool({
      name: "release_ticket",
      arguments: {
        workItemId: "item-1",
        leaseId: UUID,
        epoch: 3,
        mergeEvidence: MERGE_EVIDENCE,
        deploymentEvidence: DEPLOYMENT_EVIDENCE,
      },
    });

    expect(requests).toHaveLength(5);
    expect(requests[0]).toMatchObject({
      method: "POST",
      body: {
        workItemId: "work/a b",
        workerId: "agent-a",
        leaseDurationSeconds: 120,
      },
    });
    expect(requests[0]?.url.pathname).toBe("/api/leases");
    expect(requests[0]?.headers.has("idempotency-key")).toBe(false);
    expect(requests[1]).toMatchObject({
      method: "POST",
      body: {
        id: UUID,
        leaseId: UUID,
        epoch: 2,
        content: "Tests pass",
      },
    });
    expect(requests[1]?.url.pathname).toBe("/api/work-items/item-1/notes");
    expect(requests[1]?.headers.get("idempotency-key")).toBe(IDEMPOTENCY_KEY);
    expect(requests[2]?.body).toEqual({
      id: UUID,
      workItemId: "item-1",
      leaseId: UUID,
      epoch: 5,
      kind: "decision",
      question: "Which host?",
      blocking: false,
    });
    expect(requests[3]?.body).toEqual({
      id: UUID,
      resolution: "Use the Worker",
    });
    expect(requests[3]?.url.pathname).toBe(
      `/api/attention-requests/${UUID}/resolutions`,
    );
    expect(requests[4]?.body).toEqual({
      leaseId: UUID,
      epoch: 3,
      mergeEvidence: MERGE_EVIDENCE,
      deploymentEvidence: DEPLOYMENT_EVIDENCE,
    });
  });

  it("returns the canonical application error as an MCP tool error", async () => {
    const error = {
      error: {
        code: "lease_not_current",
        message: "The lease is stale.",
      },
    };
    const client = await protocolClient(async () =>
      Response.json(error, { status: 409 }),
    );

    const result = (await client.callTool({
      name: "renew_lease",
      arguments: {
        leaseId: UUID,
        epoch: 1,
        leaseDurationSeconds: 300,
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(error);
    expect(resultJson(result)).toEqual(error);
  });

  it("maps the remaining read and mutation tools to their REST operations", async () => {
    const requests: Request[] = [];
    const client = await protocolClient(async (request) => {
      requests.push(request.clone());
      return Response.json({ ok: true });
    });

    await client.callTool({
      name: "show_ticket",
      arguments: { workItemId: "work/a b" },
    });
    await client.callTool({
      name: "ticket_context",
      arguments: { workItemId: "work/a b" },
    });
    await client.callTool({
      name: "put_context",
      arguments: {
        workItemId: "work/a b",
        kind: "brief",
        content: "Implement ordered context.",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
    await client.callTool({
      name: "decompose_ticket",
      arguments: {
        workItemId: "item-1",
        leaseId: UUID,
        epoch: 3,
        children: [{ id: "child", title: "Implement child", rank: 10 }],
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
    await client.callTool({
      name: "cancel_ticket",
      arguments: { workItemId: "item-1", leaseId: UUID, epoch: 3 },
    });
    await client.callTool({
      name: "list_attention",
      arguments: {
        workItemId: "item-1",
        state: "resolved",
        blocking: false,
        cursor: UUID,
        limit: 10,
      },
    });
    await client.callTool({
      name: "add_note",
      arguments: {
        workItemId: "item-1",
        leaseId: UUID,
        epoch: 3,
        content: "Generated identifiers",
      },
    });

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/work-items/work%2Fa%20b/details",
      "/api/work-items/work%2Fa%20b/contexts",
      "/api/work-items/work%2Fa%20b/contexts",
      "/api/work-items/item-1/decompositions",
      "/api/work-items/item-1/cancellations",
      "/api/attention-requests",
      "/api/work-items/item-1/notes",
    ]);
    expect(requests[2]?.method).toBe("PUT");
    expect(requests[2]?.headers.get("idempotency-key")).toBe(IDEMPOTENCY_KEY);
    expect(requests[3]?.method).toBe("POST");
    expect(requests[3]?.headers.get("idempotency-key")).toBe(IDEMPOTENCY_KEY);
    const attentionListRequest = requests[5];
    const generatedNoteRequest = requests[6];
    if (attentionListRequest === undefined || generatedNoteRequest === undefined) {
      throw new Error("Expected the attention and generated-note requests.");
    }
    expect(new URL(attentionListRequest.url).search).toBe(
      `?workItemId=item-1&state=resolved&blocking=false&cursor=${UUID}&limit=10`,
    );
    const generatedNote = JSON.parse(await generatedNoteRequest.text()) as {
      id: string;
    };
    expect(generatedNote.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(generatedNoteRequest.headers.get("idempotency-key")).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
  });

  it("rejects incompatible critical-path filters before calling the application", async () => {
    const applicationFetch = vi.fn(async () => Response.json({ ok: true }));
    const client = await protocolClient(applicationFetch);

    const result = await client.callTool({
      name: "critical_path",
      arguments: {
        rootWorkItemId: "item-1",
        includeProjectIds: ["project"],
      },
    });

    expect(result.isError).toBe(true);
    expect(applicationFetch).not.toHaveBeenCalled();
  });

  it("reports a non-JSON application response without hiding the protocol failure", async () => {
    const client = await protocolClient(async () =>
      new Response("Cloudflare failure", { status: 503 }),
    );

    const result = await client.callTool({
      name: "show_ticket",
      arguments: { workItemId: "item-1" },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: "invalid_application_response",
        message: "The Work Graph application returned a non-JSON response.",
      },
    });
  });
});
