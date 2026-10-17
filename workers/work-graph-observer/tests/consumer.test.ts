import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHubDelivery } from "work-graph-domain";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  closeDb: vi.fn(),
  createDb: vi.fn(() => ({})),
  targets: vi.fn(),
}));
vi.mock("work-graph-db", () => ({
  closeDb: mocks.closeDb,
  createDb: mocks.createDb,
  GitHubDeliveryConsumer: class {
    consume = mocks.consume;
  },
  WorkGraphRepository: class {
    listGitHubReconciliationTargets = mocks.targets;
  },
}));
import worker, {
  runScheduledReconciliation,
  type ObserverBindings,
} from "../src/index";

describe("queue acknowledgments", () => {
  afterEach(() => vi.resetAllMocks());
  it("acknowledges committed dispositions and retries only failed messages", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.consume
      .mockResolvedValueOnce("processed")
      .mockRejectedValueOnce(new Error("secret database error"))
      .mockResolvedValueOnce("ignored")
      .mockResolvedValueOnce("unmatched");
    const messages = [1, 2, 3, 4].map((id) => ({
      body: { deliveryId: String(id) } as GitHubDelivery,
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    await worker.queue(
      { messages } as unknown as MessageBatch<GitHubDelivery>,
      {
        HYPERDRIVE: { connectionString: "postgres://test" },
      } as ObserverBindings,
    );
    expect(messages.map((message) => message.ack.mock.calls.length)).toEqual([
      1, 0, 1, 1,
    ]);
    expect(messages.map((message) => message.retry.mock.calls.length)).toEqual([
      0, 1, 0, 0,
    ]);
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ deliveryId: "2", disposition: "failed" }),
    );
    expect(mocks.closeDb).toHaveBeenCalledOnce();
    log.mockRestore();
    error.mockRestore();
  });

  it("runs bounded scheduled reconciliation and closes the database", async () => {
    mocks.targets.mockResolvedValueOnce([]);
    await expect(
      runScheduledReconciliation({
        HYPERDRIVE: { connectionString: "postgres://test" },
        GITHUB_ALLOWED_INSTALLATION_IDS: "[42]",
        GITHUB_ALLOWED_REPOSITORIES: '["example/site"]',
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "unused-without-targets",
      } as ObserverBindings),
    ).resolves.toEqual({
      targets: 0,
      deliveries: 0,
      processed: 0,
      ignored: 0,
      unmatched: 0,
    });
    expect(mocks.targets).toHaveBeenCalledOnce();
    expect(mocks.closeDb).toHaveBeenCalledOnce();
  });
});
