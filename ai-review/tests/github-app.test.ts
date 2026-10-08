import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInstallationToken,
  githubApiClientFromToken,
} from "../src/github-app";

const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createInstallationToken", () => {
  const privateKey = keyPair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

  it("exchanges the signed App JWT without exposing it in the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          token: "installation-token",
          expires_at: "2026-07-28T13:00:00Z",
          permissions: {},
          repository_selection: "selected",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createInstallationToken({
        appId: "123",
        installationId: "456",
        privateKey,
      }),
    ).resolves.toBe("installation-token");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/app/installations/456/access_tokens"),
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^bearer [^.]+\.[^.]+\.[^.]+$/i),
        }),
      }),
    );
  });

  it("rejects failed exchanges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("denied", { status: 401 })),
    );
    await expect(
      createInstallationToken({
        appId: "123",
        installationId: "456",
        privateKey,
      }),
    ).rejects.toThrow("denied");
  });

  it("requires deployment-time PKCS#1 to PKCS#8 conversion", async () => {
    const pkcs1 = keyPair.privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString();
    await expect(
      createInstallationToken({
        appId: "123",
        installationId: "456",
        privateKey: pkcs1,
      }),
    ).rejects.toThrow("must be unencrypted PKCS#8 PEM");
  });
});

describe("githubApiClientFromToken", () => {
  it("applies the GitHub App request headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await githubApiClientFromToken("installation-token", {
      retries: 1,
    }).request("POST", "/repos/acme/widgets/issues/1/reactions", {
      body: { content: "+1" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.github.com/repos/acme/widgets/issues/1/reactions"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          Authorization: "Bearer installation-token",
          "Content-Type": "application/json",
          "User-Agent": "personal-site-ai-review/1",
          "X-GitHub-Api-Version": "2022-11-28",
        }),
        body: JSON.stringify({ content: "+1" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
