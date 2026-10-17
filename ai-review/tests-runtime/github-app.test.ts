import {
  createGithubInstallationToken,
  GithubClient,
} from "github-client";
import { fetchWithRetry } from "ts-base/http";
import { beforeAll, describe, expect, it } from "vitest";
import { createGitHubAppAuth } from "../src/github-app";

function pem(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCodePoint(byte);
  }
  const encoded = btoa(binary).match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`;
}

describe("GitHub App authentication in workerd", () => {
  let privateKey = "";

  beforeAll(async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: Uint8Array.of(1, 0, 1),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    privateKey = pem(
      (await crypto.subtle.exportKey(
        "pkcs8",
        pair.privateKey,
      )) as ArrayBuffer,
    );
  });

  it("imports a PKCS#8 key and creates an Octokit App JWT", async () => {
    const auth = createGitHubAppAuth({
      appId: "123",
      installationId: "456",
      privateKey,
    });

    const authentication = await auth({ type: "app" });

    expect(authentication.token.split(".")).toHaveLength(3);
    expect(authentication.appId).toBe("123");
  });

  it("creates an installation token with workerd's native fetch", async () => {
    await expect(
      createGithubInstallationToken({
        appId: "123",
        installationId: "456",
        privateKey,
      }),
    ).resolves.toBe("installation-token");
  });

  it("uses workerd's native fetch through the shared JSON client", async () => {
    const client = new GithubClient("installation-token", {
      userAgent: "ai-review-test/1",
      retries: 1,
    });

    await expect(
      client.request("GET", "/repos/acme/widgets"),
    ).resolves.toEqual({ id: 1, full_name: "acme/widgets" });
  });

  it("uses workerd's native fetch through the retry helper", async () => {
    const response = await fetchWithRetry(
      "https://api.github.com/retry-test",
      { attempts: 1 },
    );

    await expect(response.text()).resolves.toBe("ok");
  });
});
