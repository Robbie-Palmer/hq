import { describe, expect, it, vi } from "vitest";
import { promiseFromSync } from "../src/promises";

describe("promiseFromSync", () => {
  it("runs the operation immediately and resolves its result", async () => {
    const operation = vi.fn(() => "result");

    const result = promiseFromSync(operation);

    expect(operation).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe("result");
  });

  it("converts a synchronous exception into a rejected promise", async () => {
    const error = new Error("failed");

    await expect(
      promiseFromSync(() => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
