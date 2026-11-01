import type {
  AnalyticsExportBatch,
  AnalyticsExportScope,
  StoredEvent,
} from "work-graph-db";
import {
  exportAnalyticsBatch,
  R2AnalyticsObjectStore,
  type AnalyticsObjectStore,
  type StoredAnalyticsObject,
} from "../src/analytics-export";

const event = (
  sequence: number,
  type: string,
  data: Record<string, unknown> = {},
): StoredEvent => ({
  sequence,
  type,
  workItemId: "ticket",
  data,
  occurredAt: new Date(`2026-10-05T00:00:${sequence.toString().padStart(2, "0")}Z`),
});

const scopes: readonly AnalyticsExportScope[] = [
  { workItemId: "z", projectId: null, initiativeId: "initiative" },
  { workItemId: "a", projectId: "project", initiativeId: "initiative" },
];

class FakeSource {
  readonly requests: Array<{ afterSequence: number; limit: number }> = [];

  constructor(
    private readonly events: readonly StoredEvent[],
    private readonly sourceUpperWatermark = events.at(-1)?.sequence ?? 0,
    private readonly sourceScopes = scopes,
  ) {}

  async readAnalyticsExportBatch(input: {
    readonly afterSequence: number;
    readonly limit: number;
  }): Promise<AnalyticsExportBatch> {
    this.requests.push(input);
    return {
      capturedAt: "2026-10-05T01:00:00.000Z",
      events: this.events
        .filter(
          ({ sequence }) =>
            sequence > input.afterSequence &&
            sequence <= this.sourceUpperWatermark,
        )
        .slice(0, input.limit),
      scopes: this.sourceScopes,
      sourceUpperWatermark: this.sourceUpperWatermark,
    };
  }
}

class FakeStore implements AnalyticsObjectStore {
  readonly objects = new Map<string, StoredAnalyticsObject>();
  readonly writes: string[] = [];
  failCheckpointWrites = 0;
  failImmutableMatch: string | null = null;
  private version = 0;

  seed(key: string, body: string): void {
    this.objects.set(key, { body, version: `v${++this.version}` });
  }

  async get(key: string): Promise<StoredAnalyticsObject | null> {
    return this.objects.get(key) ?? null;
  }

  async putImmutable(
    key: string,
    body: string,
    _contentType: string,
  ): Promise<void> {
    this.writes.push(key);
    if (this.failImmutableMatch && key.includes(this.failImmutableMatch)) {
      this.failImmutableMatch = null;
      throw new Error("interrupted upload");
    }
    const existing = this.objects.get(key);
    if (existing) {
      if (existing.body !== body) throw new Error("immutable conflict");
      return;
    }
    this.seed(key, body);
  }

  async compareAndSetCheckpoint(
    expectedVersion: string | null,
    body: string,
  ): Promise<boolean> {
    if (this.failCheckpointWrites > 0) {
      this.failCheckpointWrites--;
      throw new Error("checkpoint unavailable");
    }
    const key = "work-state/v1/checkpoint.json";
    const existing = this.objects.get(key);
    if ((existing?.version ?? null) !== expectedVersion) return false;
    this.seed(key, body);
    this.writes.push(key);
    return true;
  }
}

const objectBody = (store: FakeStore, part: string): string => {
  const entry = [...store.objects.entries()].find(([key]) =>
    key.includes(part),
  );
  if (!entry) throw new Error(`Missing object containing ${part}`);
  return entry[1].body;
};

describe("Work Graph analytics export", () => {
  it("exports bounded gap-tolerant ranges with redacted events and a scope snapshot", async () => {
    const source = new FakeSource([
      event(2, "attention.requested", {
        attentionRequestId: "request",
        leaseId: "lease",
        kind: "private prompt",
        blocking: true,
        question: "private question",
        note: "private note",
        workerId: "worker-secret",
        prompt: "private prompt",
        tokens: 100,
        logs: "private logs",
        modelCalls: ["private call"],
      }),
      event(5, "note.created", {
        noteId: "note-secret",
        leaseId: "lease",
        author: "worker-secret",
        kind: "work",
        content: "private note contents",
      }),
    ]);
    const store = new FakeStore();

    const result = await exportAnalyticsBatch(source, store, 10);

    expect(result).toMatchObject({
      status: "exported",
      eventRows: 2,
      scopeRows: 2,
      throughSequence: 5,
    });
    const exportedEvents = objectBody(store, "/events/");
    expect(exportedEvents).toContain('"attentionRequestId":"request"');
    expect(exportedEvents).toContain('"kind":"other"');
    expect(exportedEvents).toContain(
      '"data":{"kind":"work","leaseId":"lease"}',
    );
    for (const forbidden of [
      "private question",
      "private note",
      "worker-secret",
      "private prompt",
      "tokens",
      "private logs",
      "modelCalls",
      "note-secret",
      "contents",
    ]) {
      expect(exportedEvents).not.toContain(forbidden);
    }
    const scope = JSON.parse(objectBody(store, "/scopes/")) as {
      eventWatermark: number;
      rows: AnalyticsExportScope[];
    };
    expect(scope.eventWatermark).toBe(5);
    expect(scope.rows.map(({ workItemId }) => workItemId)).toEqual(["a", "z"]);
    expect(JSON.parse(objectBody(store, "/manifests/"))).toMatchObject({
      batchId: "1-5",
      complete: true,
      fromSequenceExclusive: 0,
      throughSequence: 5,
      sourceUpperWatermark: 5,
      eventObject: { rows: 2, schemaVersion: 1 },
      scopeObject: { rows: 2, schemaVersion: 1 },
    });
  });

  it("does not publish a batch when the committed range has no events", async () => {
    const store = new FakeStore();

    await expect(exportAnalyticsBatch(new FakeSource([], 5), store, 10)).resolves.toEqual({
      status: "no_events",
      eventRows: 0,
      scopeRows: 0,
      objectBytes: 0,
      manifestKey: null,
      throughSequence: 0,
    });
    expect(store.writes).toEqual([]);
  });

  it("maps legacy lease-fenced notes without a kind to work notes", async () => {
    const store = new FakeStore();

    await expect(
      exportAnalyticsBatch(
        new FakeSource([
          event(1, "note.created", {
            noteId: "private-note-id",
            leaseId: "lease",
            content: "private note contents",
          }),
        ]),
        store,
        10,
      ),
    ).resolves.toMatchObject({ status: "exported", throughSequence: 1 });

    const exportedEvents = objectBody(store, "/events/");
    expect(exportedEvents).toContain(
      '"data":{"kind":"work","leaseId":"lease"}',
    );
    expect(exportedEvents).not.toContain("private-note-id");
    expect(exportedEvents).not.toContain("private note contents");
  });

  it("resumes after an interrupted object upload without replacing immutable objects", async () => {
    const source = new FakeSource([event(1, "work_item.created")]);
    const store = new FakeStore();
    store.failImmutableMatch = "/scopes/";

    await expect(exportAnalyticsBatch(source, store, 10)).rejects.toThrow(
      "interrupted upload",
    );
    await expect(exportAnalyticsBatch(source, store, 10)).resolves.toMatchObject({
      status: "exported",
      throughSequence: 1,
    });
    expect([...store.objects.keys()].filter((key) => key.includes("/events/"))).toHaveLength(1);
  });

  it("publishes the manifest only after data objects and retries interrupted publication", async () => {
    const source = new FakeSource([event(1, "work_item.created")]);
    const store = new FakeStore();
    store.failImmutableMatch = "/manifests/";

    await expect(exportAnalyticsBatch(source, store, 10)).rejects.toThrow(
      "interrupted upload",
    );
    expect(store.writes.map((key) => key.split("/")[2])).toEqual([
      "events",
      "scopes",
      "manifests",
    ]);
    expect(
      [...store.objects.keys()].some((key) => key.includes("/manifests/")),
    ).toBe(false);
    await expect(exportAnalyticsBatch(source, store, 10)).resolves.toMatchObject({
      status: "exported",
      throughSequence: 1,
    });
  });

  it("validates a complete manifest and advances a failed checkpoint on retry", async () => {
    const source = new FakeSource([event(1, "lease.claimed", {
      leaseId: "lease",
      expiresAt: "2026-10-05T02:00:00.000Z",
      workerId: "worker-secret",
    })]);
    const store = new FakeStore();
    store.failCheckpointWrites = 1;

    await expect(exportAnalyticsBatch(source, store, 10)).rejects.toThrow(
      "checkpoint unavailable",
    );
    const writeCount = store.writes.length;
    await expect(exportAnalyticsBatch(source, store, 10)).resolves.toMatchObject({
      status: "resumed",
      throughSequence: 1,
    });
    expect(store.writes.slice(writeCount)).toEqual([
      "work-state/v1/checkpoint.json",
    ]);
  });

  it("bootstraps, resumes in bounded batches, and ignores duplicate retries", async () => {
    const source = new FakeSource(
      [
        event(1, "work_item.created"),
        event(4, "work_item.priority_moved"),
      ],
      4,
    );
    const store = new FakeStore();

    await expect(exportAnalyticsBatch(source, store, 1)).resolves.toMatchObject({
      status: "exported",
      throughSequence: 1,
    });
    await expect(exportAnalyticsBatch(source, store, 1)).resolves.toMatchObject({
      status: "exported",
      throughSequence: 4,
    });
    const writeCount = store.writes.length;
    await expect(exportAnalyticsBatch(source, store, 1)).resolves.toMatchObject({
      status: "no_events",
      throughSequence: 4,
    });
    expect(store.writes).toHaveLength(writeCount);
    expect(source.requests).toEqual([
      { afterSequence: 0, limit: 1 },
      { afterSequence: 1, limit: 1 },
      { afterSequence: 4, limit: 1 },
    ]);
    const manifests = [...store.objects.entries()]
      .filter(([key]) => key.includes("/manifests/"))
      .map(([, object]) => JSON.parse(object.body) as { sourceUpperWatermark: number });
    expect(manifests.map(({ sourceUpperWatermark }) => sourceUpperWatermark)).toEqual([4, 4]);
  });

  it("rejects unknown event and checkpoint schemas before advancing", async () => {
    const unknownEvent = event(1, "future.event");
    const store = new FakeStore();
    await expect(
      exportAnalyticsBatch(new FakeSource([unknownEvent]), store, 10),
    ).rejects.toMatchObject({
      reason: "event_schema_invalid",
      message: expect.stringContaining("Unknown Work Graph event type"),
    });
    expect(store.objects.has("work-state/v1/checkpoint.json")).toBe(false);

    await expect(
      exportAnalyticsBatch(
        new FakeSource([event(1, "lease.claimed", { leaseId: "lease" })]),
        store,
        10,
      ),
    ).rejects.toMatchObject({
      reason: "event_schema_invalid",
      message: expect.stringContaining("Unknown schema for Work Graph event"),
    });

    const invalidManifestStore = new FakeStore();
    invalidManifestStore.seed(
      "work-state/v1/manifests/1-1.json",
      JSON.stringify({
        batchId: "1-1",
        complete: true,
        manifestSchemaVersion: 1,
        fromSequenceExclusive: 0,
        throughSequence: 1,
        sourceUpperWatermark: 1,
        eventObject: {},
        scopeObject: {},
      }),
    );
    await expect(
      exportAnalyticsBatch(
        new FakeSource([event(1, "work_item.created")]),
        invalidManifestStore,
        10,
      ),
    ).rejects.toMatchObject({
      reason: "manifest_schema_invalid",
      message: expect.stringContaining("manifest has an unknown schema"),
    });

    store.seed(
      "work-state/v1/checkpoint.json",
      JSON.stringify({ schemaVersion: 2, throughSequence: 0 }),
    );
    await expect(
      exportAnalyticsBatch(new FakeSource([]), store, 10),
    ).rejects.toMatchObject({
      reason: "checkpoint_schema_invalid",
      message: expect.stringContaining("unknown schema"),
    });
  });

  it.each([
    ["attention.requested", { attentionRequestId: "request", kind: "review" }],
    [
      "lease.claimed",
      { leaseId: "lease", expiresAt: "not-a-timestamp" },
    ],
    ["lease.ended", { leaseId: "lease", outcome: "future-outcome" }],
    ["note.created", { kind: "work", leaseId: null }],
  ])("assigns a fixed reason to invalid %s data", async (type, data) => {
    await expect(
      exportAnalyticsBatch(
        new FakeSource([event(1, type, data)]),
        new FakeStore(),
        10,
      ),
    ).rejects.toMatchObject({ reason: "event_schema_invalid" });
  });

  it("assigns fixed reasons to malformed checkpoint and manifest JSON", async () => {
    const checkpointStore = new FakeStore();
    checkpointStore.seed("work-state/v1/checkpoint.json", "{");
    await expect(
      exportAnalyticsBatch(new FakeSource([]), checkpointStore, 10),
    ).rejects.toMatchObject({ reason: "checkpoint_schema_invalid" });

    const manifestStore = new FakeStore();
    manifestStore.seed("work-state/v1/manifests/1-1.json", "{");
    await expect(
      exportAnalyticsBatch(
        new FakeSource([event(1, "work_item.created")]),
        manifestStore,
        10,
      ),
    ).rejects.toMatchObject({ reason: "manifest_schema_invalid" });
  });

  it("rejects a concurrent checkpoint change", async () => {
    const source = new FakeSource([event(1, "work_item.created")]);
    const store = new FakeStore();
    const original = store.compareAndSetCheckpoint.bind(store);
    store.compareAndSetCheckpoint = async (_version, body) =>
      original("unexpected-version", body);

    await expect(exportAnalyticsBatch(source, store, 10)).rejects.toThrow(
      "checkpoint changed",
    );
  });
});

describe("R2 analytics object storage", () => {
  const object = (body: string, etag = "etag") =>
    ({ etag, text: vi.fn().mockResolvedValue(body) }) as unknown as R2ObjectBody;

  it("reads missing and existing objects", async () => {
    const bucket = {
      get: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(object("body")),
    } as unknown as R2Bucket;
    const store = new R2AnalyticsObjectStore(bucket);

    await expect(store.get("missing")).resolves.toBeNull();
    await expect(store.get("existing")).resolves.toEqual({
      body: "body",
      version: "etag",
    });
  });

  it("creates immutable objects and accepts an identical retry", async () => {
    const bucket = {
      get: vi.fn().mockResolvedValue(object("body")),
      put: vi
        .fn()
        .mockResolvedValueOnce({ etag: "created" })
        .mockResolvedValueOnce(null),
    } as unknown as R2Bucket;
    const store = new R2AnalyticsObjectStore(bucket);

    await expect(
      store.putImmutable("key", "body", "application/json"),
    ).resolves.toBeUndefined();
    await expect(
      store.putImmutable("key", "body", "application/json"),
    ).resolves.toBeUndefined();
    expect(bucket.put).toHaveBeenCalledWith("key", "body", {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
    });
  });

  it("rejects an immutable object conflict with a fixed reason", async () => {
    const bucket = {
      get: vi.fn().mockResolvedValue(object("different")),
      put: vi.fn().mockResolvedValue(null),
    } as unknown as R2Bucket;
    const store = new R2AnalyticsObjectStore(bucket);

    await expect(
      store.putImmutable("key", "body", "application/json"),
    ).rejects.toMatchObject({ reason: "immutable_object_conflict" });
  });

  it("fences initial and subsequent checkpoint writes by ETag", async () => {
    const bucket = {
      put: vi
        .fn()
        .mockResolvedValueOnce({ etag: "created" })
        .mockResolvedValueOnce(null),
    } as unknown as R2Bucket;
    const store = new R2AnalyticsObjectStore(bucket);

    await expect(store.compareAndSetCheckpoint(null, "first")).resolves.toBe(
      true,
    );
    await expect(
      store.compareAndSetCheckpoint("etag", "second"),
    ).resolves.toBe(false);
    expect(bucket.put).toHaveBeenNthCalledWith(
      1,
      "work-state/v1/checkpoint.json",
      "first",
      {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
      },
    );
    expect(bucket.put).toHaveBeenNthCalledWith(
      2,
      "work-state/v1/checkpoint.json",
      "second",
      {
        onlyIf: { etagMatches: "etag" },
        httpMetadata: { contentType: "application/json" },
      },
    );
  });
});
