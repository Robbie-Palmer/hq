import { describe, expect, it } from "vitest";

import type { WorkGraphClient } from "../../work-graph-cli/src/client";
import {
  WorkGraphCoordinator,
  type WorkGraphClientPort,
  WorkGraphIntegrationError,
  type WorkGraphLease,
  type WorkGraphWorkItem,
} from "../src";
import { task as taskFixture } from "./fixtures";

const asCoordinatorPort = (client: WorkGraphClient): WorkGraphClientPort =>
  client;
void asCoordinatorPort;

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const LEASE_ID = "10000000-4000-4000-8000-000000000001";
const NOTE_ID = "10000000-4000-4000-8000-000000000002";

const task = {
  ...taskFixture,
  taskId: "work:context-integration",
};

const lease = (
  overrides: Partial<WorkGraphLease> = {},
): WorkGraphLease => ({
  id: LEASE_ID,
  workItemId: task.taskId,
  workerId: "worker:codex",
  epoch: 3,
  acquiredAt: "2026-09-26T11:55:00.000Z",
  expiresAt: "2026-09-26T12:15:00.000Z",
  endedAt: null,
  outcome: null,
  ...overrides,
});

const workItem = (
  overrides: Partial<WorkGraphWorkItem> = {},
): WorkGraphWorkItem => ({
  id: task.taskId,
  title: "Integrate Work Graph",
  lifecycle: "open",
  parentId: "outcome:coordinator",
  rank: 1_024,
  priorityRank: null,
  schedulingInitiativeId: "initiative:agents",
  schedulingProjectId: "project:coordinator",
  expedited: false,
  expediteReason: null,
  stage: "ready",
  currentLease: null,
  priority: {
    initiativeRank: 1,
    projectRank: 2,
    ticketRank: 3,
    expedited: false,
    effectiveExpedited: false,
    donatedFromWorkItemId: null,
  },
  ...overrides,
});

const contexts = [
  {
    kind: "reference",
    title: "Parent brief",
    url: "https://example.test/brief",
    sourceWorkItemId: "outcome:coordinator",
    inheritanceDepth: 1,
  },
  {
    kind: "acceptance_criteria",
    content: "Reads do not claim work and mutations keep their fence.",
    sourceWorkItemId: task.taskId,
    inheritanceDepth: 0,
  },
  {
    kind: "architecture_decision",
    title: "Background routing decision",
    url: "https://example.test/adrs/background",
    role: "background",
    sourceWorkItemId: "outcome:coordinator",
    inheritanceDepth: 1,
  },
  {
    kind: "brief",
    content: "Connect the coordinator to Work Graph.",
    sourceWorkItemId: task.taskId,
    inheritanceDepth: 0,
  },
  {
    kind: "architecture_decision",
    title: "Governing lease decision",
    url: "https://example.test/adrs/governing",
    role: "governing",
    sourceWorkItemId: task.taskId,
    inheritanceDepth: 0,
  },
  {
    kind: "project",
    scope: { id: "project:coordinator" },
    sourceWorkItemId: "outcome:coordinator",
    inheritanceDepth: 1,
  },
] as const;

class FakeWorkGraphClient implements WorkGraphClientPort {
  item = workItem();
  contextRecords: unknown[] = [...contexts];
  dependencies = [
    {
      dependentWorkItemId: task.taskId,
      blockerWorkItemId: "work:contracts",
    },
    {
      dependentWorkItemId: "work:matching",
      blockerWorkItemId: task.taskId,
    },
  ];
  notes = [
    {
      id: "10000000-4000-4000-8000-000000000012",
      workItemId: task.taskId,
      kind: "work" as const,
      leaseId: "10000000-4000-4000-8000-000000000011",
      author: "worker:previous",
      content: "Second note",
      createdAt: "2026-09-26T11:00:00.000Z",
    },
    {
      id: "10000000-4000-4000-8000-000000000010",
      workItemId: task.taskId,
      kind: "work" as const,
      leaseId: "10000000-4000-4000-8000-000000000009",
      author: "worker:previous",
      content: "First note",
      createdAt: "2026-09-26T10:00:00.000Z",
    },
  ];
  leases: WorkGraphLease[] = [];
  reads: string[] = [];
  mutations: Array<{ operation: string; body: unknown }> = [];
  conflictOnRenew = false;

  async listWorkItems(query: {
    stage: "ready";
    initiativeId?: string;
    projectId?: string;
    parentId?: string;
    limit: number;
    cursor?: string;
  }): Promise<unknown> {
    this.reads.push(`list:${JSON.stringify(query)}`);
    return { items: [this.item], nextCursor: null };
  }

  async getWorkItem(workItemId: string): Promise<unknown> {
    this.reads.push(`item:${workItemId}`);
    return this.item;
  }

  async listWorkItemContexts(workItemId: string): Promise<unknown> {
    this.reads.push(`context:${workItemId}`);
    return { items: this.contextRecords };
  }

  async listWorkItemDependencies(
    workItemId: string,
    query: { limit: number; cursor?: string },
  ): Promise<unknown> {
    this.reads.push(`dependencies:${workItemId}:${query.limit}`);
    return { items: this.dependencies, nextCursor: null };
  }

  async listWorkItemNotes(
    workItemId: string,
    query: { limit: number; cursor?: string },
  ): Promise<unknown> {
    this.reads.push(`notes:${workItemId}:${query.limit}`);
    return { items: this.notes, nextCursor: null };
  }

  async listWorkItemLeases(
    workItemId: string,
    query: { limit: number; afterEpoch?: number },
  ): Promise<unknown> {
    this.reads.push(`leases:${workItemId}:${JSON.stringify(query)}`);
    return { items: this.leases, nextCursor: null };
  }

  async claim(body: {
    workerId: string;
    leaseDurationSeconds: number;
    workItemId: string;
  }): Promise<unknown> {
    this.mutations.push({ operation: "claim", body });
    const claimedLease = lease({ workerId: body.workerId });
    this.leases = [claimedLease];
    this.item = workItem({
      stage: "in_progress",
      currentLease: claimedLease,
    });
    return {
      lease: claimedLease,
      workItem: this.item,
      context: this.contextRecords,
    };
  }

  async renew(
    leaseId: string,
    body: { epoch: number; leaseDurationSeconds: number },
  ): Promise<unknown> {
    this.mutations.push({ operation: "renew", body: { leaseId, ...body } });
    if (this.conflictOnRenew) {
      throw Object.assign(new Error("stale epoch"), { status: 409 });
    }
    const renewed = lease({
      id: leaseId,
      epoch: body.epoch,
      expiresAt: "2026-09-26T12:30:00.000Z",
    });
    this.leases = [renewed];
    this.item = workItem({ stage: "in_progress", currentLease: renewed });
    return { lease: renewed };
  }

  async createNote(
    workItemId: string,
    body: { id: string; leaseId: string; epoch: number; content: string },
    idempotencyKey?: string,
  ): Promise<unknown> {
    this.mutations.push({
      operation: "checkpoint",
      body: { workItemId, ...body, idempotencyKey },
    });
    return {
      id: body.id,
      workItemId,
      kind: "work",
      leaseId: body.leaseId,
      author: "worker:codex",
      content: body.content,
      createdAt: "2026-09-26T12:01:00.000Z",
    };
  }

  async release(
    workItemId: string,
    body: {
      leaseId: string;
      epoch: number;
      mergeEvidence: string;
      deploymentEvidence: string;
    },
  ): Promise<unknown> {
    this.mutations.push({ operation: "release", body });
    const releasedLease = lease({
      id: body.leaseId,
      epoch: body.epoch,
      endedAt: "2026-09-26T12:05:00.000Z",
      outcome: "released",
    });
    this.leases = [releasedLease];
    this.item = workItem({
      id: workItemId,
      lifecycle: "released",
      stage: "released",
      currentLease: null,
    });
    return { lease: releasedLease, workItem: this.item };
  }
}

const coordinator = (client: FakeWorkGraphClient, now = NOW) =>
  new WorkGraphCoordinator(client, {
    createId: () => NOTE_ID,
    now: () => now,
  });

const expectIntegrationError = async (
  promise: Promise<unknown>,
  code: string,
) => {
  await expect(promise).rejects.toMatchObject({
    name: "WorkGraphIntegrationError",
    code,
  });
};

describe("Work Graph coordinator integration", () => {
  it("reads scoped ready work and requirements without changing graph state", async () => {
    const client = new FakeWorkGraphClient();
    const integration = coordinator(client);
    const originalPriority = structuredClone(client.item.priority);

    const candidates = await integration.listReadyCandidates(
      { projectId: "project:coordinator" },
      { limit: 5 },
    );
    const requirements = await integration.readRequirements(task.taskId);
    const firstPackage = await integration.buildContextPackage(task);
    const secondPackage = await integration.buildContextPackage(task);

    expect(candidates.items.map(({ id }) => id)).toEqual([task.taskId]);
    expect(client.reads[0]).toContain('"projectId":"project:coordinator"');
    expect(requirements).toMatchObject({
      workItemId: task.taskId,
      brief: { content: "Connect the coordinator to Work Graph." },
    });
    expect(firstPackage).toEqual(secondPackage);
    expect(firstPackage.architectureDecisions.map(({ role }) => role)).toEqual([
      "governing",
      "background",
    ]);
    expect(firstPackage.notes.map(({ content }) => content)).toEqual([
      "First note",
      "Second note",
    ]);
    expect(firstPackage.requiredEvidence).toEqual([
      { kind: "handoff-note", stage: "checkpoint" },
      { kind: "test-results", stage: "completion" },
    ]);
    expect(client.mutations).toEqual([]);
    expect(client.item.lifecycle).toBe("open");
    expect(client.item.priority).toEqual(originalPriority);
  });

  it("keeps the worker and epoch fence through claim, renewal, checkpoint, and release", async () => {
    const client = new FakeWorkGraphClient();
    const integration = coordinator(client);

    const claimed = await integration.claim(task, {
      workerId: "worker:codex",
      leaseDurationSeconds: 900,
    });
    const renewed = await integration.renew(claimed.lease, 1_200);
    const checkpoint = await integration.checkpoint(
      renewed,
      "Implemented the Work Graph facade and integration tests.",
      { renewForSeconds: 1_200 },
    );
    const released = await integration.release(checkpoint.lease, {
      mergeEvidence: "https://github.com/example/repo/pull/42",
      deploymentEvidence: "https://example.test/deployments/42",
    });

    expect(claimed.context.workItem.id).toBe(task.taskId);
    expect(client.mutations).toMatchObject([
      {
        operation: "claim",
        body: {
          workItemId: task.taskId,
          workerId: "worker:codex",
          leaseDurationSeconds: 900,
        },
      },
      {
        operation: "renew",
        body: { leaseId: LEASE_ID, epoch: 3, leaseDurationSeconds: 1_200 },
      },
      {
        operation: "checkpoint",
        body: {
          workItemId: task.taskId,
          id: NOTE_ID,
          leaseId: LEASE_ID,
          epoch: 3,
          idempotencyKey: NOTE_ID,
        },
      },
      {
        operation: "renew",
        body: { leaseId: LEASE_ID, epoch: 3, leaseDurationSeconds: 1_200 },
      },
      {
        operation: "release",
        body: {
          leaseId: LEASE_ID,
          epoch: 3,
          mergeEvidence: "https://github.com/example/repo/pull/42",
          deploymentEvidence: "https://example.test/deployments/42",
        },
      },
    ]);
    expect(released.lease.outcome).toBe("released");
    expect(released.workItem.lifecycle).toBe("released");
  });

  it("observes expiry and rejects a local mutation after the deadline", async () => {
    const client = new FakeWorkGraphClient();
    const expired = lease({ expiresAt: "2026-09-26T11:59:00.000Z" });
    client.leases = [expired];
    client.item = workItem({ stage: "stale", currentLease: expired });
    const integration = coordinator(client);

    const observation = await integration.observeLease(expired);

    expect(observation.status).toBe("expired");
    await expectIntegrationError(integration.renew(expired, 900), "lease_expired");
    expect(client.mutations).toEqual([]);
  });

  it("turns stale server fencing into an actionable coordinator error", async () => {
    const client = new FakeWorkGraphClient();
    client.conflictOnRenew = true;
    const integration = coordinator(client);

    await expectIntegrationError(
      integration.renew(lease(), 900),
      "stale_lease",
    );
  });

  it("rejects missing and conflicting required context before claiming", async () => {
    const missingClient = new FakeWorkGraphClient();
    missingClient.contextRecords = contexts.filter(
      ({ kind }) => kind !== "acceptance_criteria",
    );
    await expectIntegrationError(
      coordinator(missingClient).claim(task, {
        workerId: "worker:codex",
        leaseDurationSeconds: 900,
      }),
      "missing_context",
    );
    expect(missingClient.mutations).toEqual([]);

    const conflictingClient = new FakeWorkGraphClient();
    conflictingClient.contextRecords.push({
      kind: "brief",
      content: "A conflicting brief.",
      sourceWorkItemId: "outcome:coordinator",
      inheritanceDepth: 1,
    });
    await expectIntegrationError(
      coordinator(conflictingClient).readRequirements(task.taskId),
      "context_conflict",
    );
  });

  it("fails closed when context exceeds an item or byte bound", async () => {
    const notesClient = new FakeWorkGraphClient();
    const boundedNotes = new WorkGraphCoordinator(notesClient, {
      maxNotes: 1,
      now: () => NOW,
    });
    await expectIntegrationError(
      boundedNotes.buildContextPackage(task),
      "context_limit_exceeded",
    );

    const bytesClient = new FakeWorkGraphClient();
    bytesClient.contextRecords = contexts.map((record) =>
      record.kind === "brief"
        ? { ...record, content: "x".repeat(2_000) }
        : record,
    );
    const boundedBytes = new WorkGraphCoordinator(bytesClient, {
      maxPackageBytes: 1_024,
      now: () => NOW,
    });
    await expectIntegrationError(
      boundedBytes.buildContextPackage(task),
      "context_limit_exceeded",
    );
  });

  it("exports a distinct integration error for callers that need recovery policy", () => {
    expect(
      new WorkGraphIntegrationError("stale_lease", "refresh the claim"),
    ).toMatchObject({ code: "stale_lease", message: "refresh the claim" });
  });
});
