import { describe, expect, it, vi } from "vitest";

import { openRouterClient } from "../src";

describe("openRouterClient", () => {
  it("targets OpenRouter and authenticates requests", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        id: "completion",
        object: "chat.completion",
        created: 0,
        model: "provider/model",
        choices: [],
      }),
    );
    const client = openRouterClient("openrouter-key", {
      fetch,
      maxRetries: 0,
    });

    await client.chat.completions.create({
      model: "provider/model",
      messages: [{ role: "user", content: "Review this" }],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer openrouter-key",
    );
  });
});
