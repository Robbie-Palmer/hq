import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHubDelivery } from "work-graph-domain";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  closeDb: vi.fn(),
  createDb: vi.fn(() => ({})),
}));
vi.mock("work-graph-db", () => ({
  closeDb: mocks.closeDb,
  createDb: mocks.createDb,
  GitHubDeliveryConsumer: class {
    consume = mocks.consume;
  },
}));
import worker, { type ObserverBindings } from "../src/index";

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
});
