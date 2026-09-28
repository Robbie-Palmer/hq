import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createAppAuth: vi.fn(),
  requestDefaults: vi.fn(),
}));

vi.mock("@octokit/auth-app", () => ({ createAppAuth: mocks.createAppAuth }));
vi.mock("@octokit/request", () => ({
  request: { defaults: mocks.requestDefaults },
}));

import { createGithubInstallationToken, GithubClient } from "../src";

describe("GithubClient", () => {
  beforeEach(() => {
    mocks.authenticate.mockReset();
    mocks.createAppAuth.mockReset().mockReturnValue(mocks.authenticate);
    mocks.requestDefaults.mockReset().mockReturnValue(vi.fn());
  });

  it("applies the shared GitHub headers", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const client = new GithubClient("installation-token", {
      userAgent: "test-client/1",
      fetch,
      retries: 1,
    });

    await client.request("POST", "/repos/acme/widgets/issues/1/reactions", {
      body: { content: "+1" },
    });

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://api.github.com/repos/acme/widgets/issues/1/reactions"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer installation-token",
          "User-Agent": "test-client/1",
          "X-GitHub-Api-Version": "2022-11-28",
        }),
      }),
    );
  });

  it("paginates GitHub collections until a short page", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json([1, 2]))
      .mockResolvedValueOnce(Response.json([3]));
    const client = new GithubClient("installation-token", {
      userAgent: "test-client/1",
      fetch,
    });

    await expect(
      client.paginate<number>("/repos/acme/widgets/issues", {
        perPage: 2,
        query: { state: "open" },
      }),
    ).resolves.toEqual({ items: [1, 2, 3], pages: 2, complete: true });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.github.com/repos/acme/widgets/issues?state=open&per_page=2&page=1",
      "https://api.github.com/repos/acme/widgets/issues?state=open&per_page=2&page=2",
    ]);
  });

  it("reports when a GitHub pagination safety limit is reached", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json([1, 2]));
    const client = new GithubClient("installation-token", {
      userAgent: "test-client/1",
      fetch,
    });

    await expect(
      client.paginate<number>("/repos/acme/widgets/issues", {
        perPage: 2,
        maxPages: 2,
      }),
    ).resolves.toEqual({ items: [1, 2, 1, 2], pages: 2, complete: false });
  });

  it("rejects pagination outside GitHub's bounds", async () => {
    const client = new GithubClient("installation-token", {
      userAgent: "test-client/1",
    });

    await expect(
      client.paginate("/repos/acme/widgets/issues", { perPage: 101 }),
    ).rejects.toThrow(RangeError);
    await expect(
      client.paginate("/repos/acme/widgets/issues", { maxPages: 0 }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects GitHub App keys that are not PKCS#8", async () => {
    await expect(
      createGithubInstallationToken({
        appId: "123",
        installationId: "456",
        privateKey: "invalid",
      }),
    ).rejects.toThrow("unencrypted PKCS#8 PEM");
  });

  it("creates a GitHub App installation token with the bounded request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const privateKey = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ") + "\ntest";
    mocks.authenticate.mockResolvedValue({ token: "installation-token" });

    await expect(
      createGithubInstallationToken({
        appId: "123",
        installationId: "456",
        privateKey,
        timeoutMs: 2_000,
        fetch,
      }),
    ).resolves.toBe("installation-token");

    expect(mocks.createAppAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "123",
        installationId: 456,
        privateKey,
        request: expect.any(Function),
      }),
    );
    expect(mocks.authenticate).toHaveBeenCalledWith({ type: "installation" });

    const requestOptions = mocks.requestDefaults.mock.calls[0]?.[0];
    await requestOptions.request.fetch("https://api.github.com/app");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/app",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects non-array responses from paginated GitHub endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 1 }));
    const client = new GithubClient("installation-token", {
      userAgent: "test-client/1",
      fetch,
    });

    await expect(client.paginate("/repos/acme/widgets/issues")).rejects.toThrow(
      "must return an array",
    );
  });
});
