import { describe, expect, it, vi } from "vitest";
import {
  createProgressStream,
  parseLastEventId,
  progressEventId,
  progressStreamResponse,
  readRecipeBatchProgress,
  readRecipeImportProgress,
  recipeImportProgress,
  type ProgressSnapshot,
} from "../src/progress-stream";

type TestState = {
  revision: number;
  status: "running" | "succeeded";
};

class ManualWait {
  private readonly resolvers: Array<() => void> = [];

  readonly wait = () =>
    new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });

  async release(): Promise<void> {
    while (this.resolvers.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.resolvers.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function snapshot(
  revision: number,
  status: TestState["status"] = "running",
): ProgressSnapshot<TestState> {
  return {
    state: { revision, status },
    terminal: status === "succeeded",
  };
}

async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const result = await reader.read();
  expect(result.done).toBe(false);
  return new TextDecoder().decode(result.value);
}

function eventData(frame: string) {
  const line = frame
    .split("\n")
    .find((candidate) => candidate.startsWith("data: "));
  if (!line) throw new Error("SSE frame has no data line");
  return JSON.parse(line.slice("data: ".length)) as {
    replay: { matched: boolean; requestedEventId: string | null };
    state: TestState;
    terminal: boolean;
  };
}

describe("recipe progress event streams", () => {
  it("projects persisted photo and batch records into resumable state", async () => {
    const date = new Date("2026-10-29T20:00:00.000Z");
    const photoJob = {
      id: "018f2b16-43b4-7e7a-8d4b-9f3559865353",
      status: "failed",
      currentStage: "normalize",
      progressLabel: "Import failed",
      imageCount: 2,
      errorType: "ProviderError",
      errorMessage: "Provider unavailable",
      createdAt: date,
      updatedAt: date,
      finishedAt: date,
    } as Parameters<typeof recipeImportProgress>[0];
    const photoLimit = vi.fn().mockResolvedValue([photoJob]);
    const photoDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: photoLimit })),
        })),
      })),
    } as never;

    expect(
      await readRecipeImportProgress(photoDb, "owner", photoJob.id),
    ).toEqual({
      state: recipeImportProgress(photoJob),
      terminal: true,
    });
    expect(
      recipeImportProgress({
        ...photoJob,
        status: "running",
        errorType: null,
        errorMessage: null,
        finishedAt: null,
      }),
    ).toMatchObject({ error: undefined });
    photoLimit.mockResolvedValueOnce([]);
    await expect(
      readRecipeImportProgress(photoDb, "owner", photoJob.id),
    ).resolves.toBeUndefined();

    const batch = {
      id: "018f2b16-43b4-7e7a-8d4b-9f3559865354",
      startedAt: date,
      undoStartedAt: null,
      undoCompletedAt: null,
      createdAt: date,
    };
    const item = {
      id: photoJob.id,
      position: 0,
      status: "failed",
      currentStage: null,
      progressLabel: "Import failed",
      reviewState: "skipped",
      executionAttempt: 1,
      draftVersion: 1,
      errorType: "ParseError",
      errorMessage: "Invalid recipe",
      createdAt: date,
      updatedAt: date,
      finishedAt: date,
    };
    const batchLimit = vi.fn().mockResolvedValue([batch]);
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: batchLimit })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn().mockResolvedValue([item]),
          })),
        })),
      });

    const batchSnapshot = await readRecipeBatchProgress(
      { select } as never,
      "owner",
      batch.id,
    );
    expect(batchSnapshot).toMatchObject({
      state: {
        id: batch.id,
        status: "completed",
        counts: { skipped: 1 },
        items: [
          {
            error: { type: "ParseError", message: "Invalid recipe" },
          },
        ],
      },
      terminal: true,
    });

    const missingBatchDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })),
    } as never;
    await expect(
      readRecipeBatchProgress(missingBatchDb, "owner", batch.id),
    ).resolves.toBeUndefined();
  });

  it("uses deterministic IDs and validates reconnect cursors", async () => {
    const state = snapshot(1).state;
    const first = await progressEventId("recipe-import", state);
    const repeated = await progressEventId("recipe-import", state);

    expect(first).toBe(repeated);
    expect(parseLastEventId(undefined)).toEqual({
      success: true,
      value: undefined,
    });
    expect(parseLastEventId(first)).toEqual({ success: true, value: first });
    expect(parseLastEventId("v1:not-a-digest")).toEqual({ success: false });
  });

  it("collapses duplicate polls and recovers the latest state after missed events", async () => {
    const gate = new ManualWait();
    const persisted = [snapshot(1), snapshot(3, "succeeded")];
    const readSnapshot = vi
      .fn<() => Promise<ProgressSnapshot<TestState>>>()
      .mockImplementation(async () => persisted.shift() ?? snapshot(3, "succeeded"));
    const reader = createProgressStream({
      initialSnapshot: snapshot(1),
      resource: "recipe-import",
      readSnapshot,
      wait: gate.wait,
    }).getReader();

    const initial = eventData(await readFrame(reader));
    expect(initial.state.revision).toBe(1);

    await gate.release();
    await gate.release();
    const recovered = eventData(await readFrame(reader));
    expect(recovered.state).toEqual({ revision: 3, status: "succeeded" });
    expect(recovered.terminal).toBe(true);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it("replays completed persisted state even when Last-Event-ID matches", async () => {
    const completed = snapshot(4, "succeeded");
    const id = await progressEventId("recipe-import", completed.state);
    const readSnapshot = vi.fn<() => Promise<ProgressSnapshot<TestState>>>();
    const reader = createProgressStream({
      initialSnapshot: completed,
      lastEventId: id,
      resource: "recipe-import",
      readSnapshot,
    }).getReader();

    const frame = await readFrame(reader);
    expect(frame).toContain(`id: ${id}\n`);
    expect(frame).toContain("event: terminal\n");
    expect(eventData(frame)).toMatchObject({
      replay: { matched: true, requestedEventId: id },
      state: completed.state,
      terminal: true,
    });
    expect(readSnapshot).not.toHaveBeenCalled();
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it("sends a heartbeat after fifteen seconds without a state change", async () => {
    const gate = new ManualWait();
    let now = 0;
    const reader = createProgressStream({
      initialSnapshot: snapshot(1),
      resource: "recipe-import-batch",
      readSnapshot: async () => snapshot(1),
      wait: gate.wait,
      now: () => now,
    }).getReader();

    await readFrame(reader);
    now = 15_000;
    await gate.release();
    expect(await readFrame(reader)).toBe(": heartbeat\n\n");
    await reader.cancel();
  });

  it("stops only the subscriber when the client disconnects", async () => {
    const gate = new ManualWait();
    const readSnapshot = vi.fn(async () => snapshot(2));
    const onDisconnect = vi.fn(async () => undefined);
    const reader = createProgressStream({
      initialSnapshot: snapshot(1),
      resource: "recipe-import",
      readSnapshot,
      wait: gate.wait,
      onDisconnect,
    }).getReader();

    await readFrame(reader);
    await reader.cancel();

    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it("closes the subscriber connection when the request aborts", async () => {
    const gate = new ManualWait();
    const abort = new AbortController();
    const onDisconnect = vi.fn(async () => undefined);
    const reader = createProgressStream({
      initialSnapshot: snapshot(1),
      resource: "recipe-import",
      readSnapshot: vi.fn(async () => snapshot(2)),
      wait: gate.wait,
      signal: abort.signal,
      onDisconnect,
    }).getReader();

    await readFrame(reader);
    abort.abort();
    await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce());
    await reader.cancel();
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("closes resources when a persisted-state read fails", async () => {
    const gate = new ManualWait();
    const failure = new Error("database unavailable");
    const onDisconnect = vi.fn(async () => undefined);
    const reader = createProgressStream({
      initialSnapshot: snapshot(1),
      resource: "recipe-import",
      readSnapshot: vi.fn().mockRejectedValue(failure),
      wait: gate.wait,
      onDisconnect,
    }).getReader();

    await readFrame(reader);
    await gate.release();
    await expect(reader.read()).rejects.toThrow("database unavailable");
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("builds an SSE response around a terminal persisted snapshot", async () => {
    const response = progressStreamResponse({
      initialSnapshot: snapshot(5, "succeeded"),
      resource: "recipe-import",
      readSnapshot: vi.fn(),
    });

    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(await response.text()).toContain("event: terminal\n");
  });
});
