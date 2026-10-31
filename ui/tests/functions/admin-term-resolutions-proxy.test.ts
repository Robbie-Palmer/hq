import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../../../functions/api/admin/term-resolutions/[[path]]";

describe("admin term resolution proxy", () => {
  it("preserves the admin API path and request body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(
      "https://recipes.example.test/api/admin/term-resolutions/decision-1/reproject",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=test",
        },
        body: JSON.stringify({ retry: true }),
      },
    );

    const response = await onRequest({
      request,
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    });

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    expect((forwarded as Request).url).toBe(
      "https://recipe-api.example.test/api/admin/term-resolutions/decision-1/reproject",
    );
    expect(await (forwarded as Request).clone().json()).toEqual({
      retry: true,
    });
  });
});
