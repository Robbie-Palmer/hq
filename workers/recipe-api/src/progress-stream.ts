import { and, eq } from "drizzle-orm";
import type { Db } from "recipe-db";
import {
  recipeImportBatch as batches,
  recipeImportJob as jobs,
} from "recipe-db/schema";
import { sha256Hex } from "ts-base/crypto";
import { batchProgress } from "./batch-imports";

const encoder = new TextEncoder();

export const PROGRESS_POLL_INTERVAL_MS = 1_000;
export const PROGRESS_HEARTBEAT_INTERVAL_MS = 15_000;
export const PROGRESS_EVENT_ID_PATTERN = /^v1:[a-f0-9]{64}$/;

type ImportJob = typeof jobs.$inferSelect;

export type ProgressSnapshot<State> = {
  state: State;
  terminal: boolean;
};

export type RecipeImportProgress = ReturnType<typeof recipeImportProgress>;
export type RecipeBatchProgress = Awaited<
  ReturnType<typeof readRecipeBatchProgress>
>;

type Wait = (milliseconds: number) => Promise<void>;

export type ProgressStreamOptions<State> = {
  initialSnapshot: ProgressSnapshot<State>;
  lastEventId?: string;
  readSnapshot: () => Promise<ProgressSnapshot<State>>;
  resource: "recipe-import" | "recipe-import-batch";
  signal?: AbortSignal;
  wait?: Wait;
  now?: () => number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  onDisconnect?: () => Promise<void> | void;
};

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function recipeImportProgress(job: ImportJob) {
  return {
    id: job.id,
    status: job.status,
    currentStage: job.currentStage,
    progressLabel: job.progressLabel,
    imageCount: job.imageCount,
    error: job.errorMessage
      ? { type: job.errorType, message: job.errorMessage }
      : undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
}

export async function readRecipeImportProgress(
  db: Db,
  userId: string,
  jobId: string,
): Promise<ProgressSnapshot<RecipeImportProgress> | undefined> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  if (!job) return undefined;
  return {
    state: recipeImportProgress(job),
    terminal: job.status === "succeeded" || job.status === "failed",
  };
}

export async function readRecipeBatchProgress(
  db: Db,
  userId: string,
  batchId: string,
) {
  const [batch] = await db
    .select()
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.userId, userId)))
    .limit(1);
  if (!batch) return undefined;

  const items = await db
    .select({
      id: jobs.id,
      position: jobs.position,
      status: jobs.status,
      currentStage: jobs.currentStage,
      progressLabel: jobs.progressLabel,
      reviewState: jobs.reviewState,
      executionAttempt: jobs.executionAttempt,
      draftVersion: jobs.draftVersion,
      errorType: jobs.errorType,
      errorMessage: jobs.errorMessage,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      finishedAt: jobs.finishedAt,
    })
    .from(jobs)
    .where(eq(jobs.batchId, batch.id))
    .orderBy(jobs.position);
  const progress = batchProgress(items);
  let status = progress.status;
  if (!batch.startedAt) status = "preparing";
  if (batch.undoStartedAt) {
    status = "undoing";
    if (batch.undoCompletedAt) status = "undone";
  }

  return {
    state: {
      id: batch.id,
      status,
      counts: progress.counts,
      startedAt: batch.startedAt,
      undoStartedAt: batch.undoStartedAt,
      undoCompletedAt: batch.undoCompletedAt,
      createdAt: batch.createdAt,
      items: items.map((item) => ({
        ...item,
        error: item.errorMessage
          ? { type: item.errorType, message: item.errorMessage }
          : undefined,
        errorType: undefined,
        errorMessage: undefined,
      })),
    },
    terminal: status === "completed" || status === "undone",
  };
}

export function parseLastEventId(value: string | undefined) {
  if (!value) return { success: true as const, value: undefined };
  if (!PROGRESS_EVENT_ID_PATTERN.test(value)) {
    return { success: false as const };
  }
  return { success: true as const, value };
}

export async function progressEventId(
  resource: ProgressStreamOptions<unknown>["resource"],
  state: unknown,
): Promise<string> {
  const digest = await sha256Hex(
    JSON.stringify({ protocolVersion: 1, resource, state }),
  );
  return `v1:${digest}`;
}

function eventFrame<State>(
  id: string,
  snapshot: ProgressSnapshot<State>,
  lastEventId: string | undefined,
): Uint8Array {
  const event = snapshot.terminal ? "terminal" : "progress";
  const data = JSON.stringify({
    protocolVersion: 1,
    terminal: snapshot.terminal,
    replay: {
      window: "current-state",
      requestedEventId: lastEventId ?? null,
      matched: lastEventId === id,
    },
    state: snapshot.state,
  });
  return encoder.encode(
    `id: ${id}\nevent: ${event}\nretry: ${PROGRESS_POLL_INTERVAL_MS}\ndata: ${data}\n\n`,
  );
}

function heartbeatFrame(): Uint8Array {
  return encoder.encode(": heartbeat\n\n");
}

export function createProgressStream<State>(
  options: ProgressStreamOptions<State>,
): ReadableStream<Uint8Array> {
  let pump: ProgressStreamPump<State> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      pump = new ProgressStreamPump(controller, options);
      pump.start();
    },
    cancel: () => pump?.cancel(),
  });
}

class ProgressStreamPump<State> {
  private readonly wait: Wait;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private stopped = false;
  private cleanedUp = false;
  private currentId = "";
  private lastFrameAt = 0;

  constructor(
    private readonly controller: ReadableStreamDefaultController<Uint8Array>,
    private readonly options: ProgressStreamOptions<State>,
  ) {
    this.wait = options.wait ?? defaultWait;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs =
      options.pollIntervalMs ?? PROGRESS_POLL_INTERVAL_MS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? PROGRESS_HEARTBEAT_INTERVAL_MS;
  }

  start(): void {
    this.options.signal?.addEventListener("abort", this.stop, { once: true });
    void this.run();
  }

  async cancel(): Promise<void> {
    this.stopped = true;
    await this.cleanup();
  }

  private readonly stop = () => {
    this.stopped = true;
    void this.cleanup();
  };

  private active(): boolean {
    return !this.stopped && !this.options.signal?.aborted;
  }

  private async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    await this.options.onDisconnect?.();
  }

  private async emit(snapshot: ProgressSnapshot<State>): Promise<void> {
    this.currentId = await progressEventId(
      this.options.resource,
      snapshot.state,
    );
    this.controller.enqueue(
      eventFrame(this.currentId, snapshot, this.options.lastEventId),
    );
    this.lastFrameAt = this.now();
  }

  private heartbeatIfDue(): void {
    if (this.now() - this.lastFrameAt < this.heartbeatIntervalMs) return;
    this.controller.enqueue(heartbeatFrame());
    this.lastFrameAt = this.now();
  }

  private async pollUntilTerminal(): Promise<void> {
    while (this.active()) {
      await this.wait(this.pollIntervalMs);
      if (!this.active()) return;

      const snapshot = await this.options.readSnapshot();
      const nextId = await progressEventId(
        this.options.resource,
        snapshot.state,
      );
      if (nextId === this.currentId) {
        this.heartbeatIfDue();
        continue;
      }
      await this.emit(snapshot);
      if (snapshot.terminal) return;
    }
  }

  private async run(): Promise<void> {
    try {
      await this.emit(this.options.initialSnapshot);
      if (!this.options.initialSnapshot.terminal) {
        await this.pollUntilTerminal();
      }
      await this.cleanup();
      if (!this.stopped) this.controller.close();
    } catch (error) {
      await this.cleanup();
      if (!this.stopped) this.controller.error(error);
    } finally {
      this.options.signal?.removeEventListener("abort", this.stop);
    }
  }
}

export function progressStreamResponse<State>(
  options: ProgressStreamOptions<State>,
): Response {
  return new Response(createProgressStream(options), {
    headers: {
      "Cache-Control": "private, no-store, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
