import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseR2ParentCredentials,
  recoverR2CredentialBroker,
  runR2CredentialBroker,
  type BrokerProcessRequest,
  type BrokerProcessResult,
  type R2ParentCredentials,
} from "../src/index";

const accountId = "0123456789abcdef0123456789abcdef";
const parentCredentials: R2ParentCredentials = {
  schemaVersion: 1,
  apiToken: "parent-api-token",
  accessKeyId: "parent-access-key",
  secretAccessKey: "parent-secret-key",
};

const temporaryCredentials = {
  accessKeyId: "temporary-access-key",
  secretAccessKey: "temporary-secret-key",
  sessionToken: "temporary-session-token",
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function receiptPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "r2-broker-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "receipt.json");
}

function jsonResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status < 400, result }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successfulFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "DELETE") return jsonResponse({});
    if (init?.method === "GET") return jsonResponse(undefined, 404);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return "parentAccessKeyId" in body
      ? jsonResponse(temporaryCredentials)
      : jsonResponse({ name: body.name });
  });
}

function result(
  exitCode: number,
  stderr = "",
  stdout = "",
): BrokerProcessResult {
  return { exitCode, stderr, stdout };
}

function brokerInput(receipt: string) {
  return {
    accountId,
    bucketPrefix: "hq-oci-r2-canary",
    command: "consumer",
    commandArguments: ["--live"],
    helperCommand: "r2-helper",
    parentCredentials,
    receiptPath: receipt,
    ttlSeconds: 1800,
    environment: {
      PATH: "/tools",
      HOME: "/home/runner",
      CLOUDFLARE_R2_PARENT_CREDENTIALS: "must-not-leak",
      GH_TOKEN: "must-not-leak",
    },
  };
}

describe("R2 parent credential parsing", () => {
  it("accepts the versioned parent bundle", () => {
    expect(
      parseR2ParentCredentials(JSON.stringify(parentCredentials)),
    ).toEqual(parentCredentials);
  });

  it.each([
    ["not-json", "valid JSON"],
    ["null", "must be an object"],
    [JSON.stringify({ ...parentCredentials, schemaVersion: 2 }), "schemaVersion"],
    [JSON.stringify({ ...parentCredentials, apiToken: "" }), "apiToken"],
    [JSON.stringify({ ...parentCredentials, accessKeyId: 3 }), "accessKeyId"],
    [JSON.stringify({ ...parentCredentials, secretAccessKey: "" }), "secretAccessKey"],
  ])("rejects an invalid parent bundle", (source, message) => {
    expect(() => parseR2ParentCredentials(source)).toThrow(message);
  });
});

describe("R2 temporary credential broker", () => {
  it("scopes the child, isolates the parent, and deletes owned buckets", async () => {
    const receipt = await receiptPath();
    const fetch = successfulFetch();
    const requests: BrokerProcessRequest[] = [];
    const runProcess = vi.fn(async (request: BrokerProcessRequest) => {
      requests.push(request);
      if (request.arguments[0] === "head" && request.arguments[1]?.endsWith("-scope")) {
        return result(1, "An error occurred (403): Forbidden");
      }
      return result(0);
    });

    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch,
        now: () => new Date("2026-11-18T12:00:00Z"),
        randomSuffix: () => "0123456789",
        runProcess,
      }),
    ).resolves.toEqual({ bucket: "hq-oci-r2-canary-0123456789" });

    const consumer = requests.find(({ command }) => command === "consumer");
    expect(consumer?.environment).toMatchObject({
      PATH: "/tools",
      HOME: "/home/runner",
      AWS_ACCESS_KEY_ID: temporaryCredentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: temporaryCredentials.secretAccessKey,
      AWS_SESSION_TOKEN: temporaryCredentials.sessionToken,
      R2_BUCKET: "hq-oci-r2-canary-0123456789",
    });
    expect(consumer?.environment).not.toHaveProperty(
      "CLOUDFLARE_R2_PARENT_CREDENTIALS",
    );
    expect(consumer?.environment).not.toHaveProperty("GH_TOKEN");

    const purges = requests.filter(({ arguments: arguments_ }) => arguments_[0] === "purge");
    expect(purges).toHaveLength(2);
    expect(purges[0]?.environment).toMatchObject({
      AWS_ACCESS_KEY_ID: parentCredentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: parentCredentials.secretAccessKey,
    });
    expect(purges[0]?.environment).not.toHaveProperty("AWS_SESSION_TOKEN");

    const temporaryRequest = fetch.mock.calls.find(([, init]) =>
      String(init?.body).includes("parentAccessKeyId"),
    );
    expect(JSON.parse(String(temporaryRequest?.[1]?.body))).toEqual({
      bucket: "hq-oci-r2-canary-0123456789",
      parentAccessKeyId: parentCredentials.accessKeyId,
      permission: "object-read-write",
      ttlSeconds: 1800,
    });
    expect(temporaryRequest?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${parentCredentials.apiToken}`,
    });
    await expect(readFile(receipt, "utf8")).rejects.toThrow();
  });

  it("cleans both buckets when the consumer fails", async () => {
    const receipt = await receiptPath();
    const requests: BrokerProcessRequest[] = [];
    const runProcess = vi.fn(async (request: BrokerProcessRequest) => {
      requests.push(request);
      if (request.command === "consumer") return result(7);
      if (request.arguments[0] === "head" && request.arguments[1]?.endsWith("-scope")) {
        return result(1, "AccessDenied");
      }
      return result(0);
    });

    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch: successfulFetch(),
        randomSuffix: () => "0123456789",
        runProcess,
      }),
    ).rejects.toThrow("consumer failed with exit code 7");
    expect(requests.filter(({ arguments: args }) => args[0] === "purge")).toHaveLength(2);
    await expect(readFile(receipt, "utf8")).rejects.toThrow();
  });

  it("retains the receipt and fails closed when cleanup fails", async () => {
    const receipt = await receiptPath();
    const runProcess = vi.fn(async (request: BrokerProcessRequest) => {
      if (request.arguments[0] === "head" && request.arguments[1]?.endsWith("-scope")) {
        return result(1, "403 Forbidden");
      }
      if (request.arguments[0] === "purge") return result(1, "cleanup failed");
      return result(0);
    });

    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch: successfulFetch(),
        randomSuffix: () => "0123456789",
        runProcess,
      }),
    ).rejects.toThrow("cleanup failed; receipt retained");
    expect(JSON.parse(await readFile(receipt, "utf8"))).toMatchObject({
      bucketPrefix: "hq-oci-r2-canary",
      plannedBuckets: [
        "hq-oci-r2-canary-0123456789",
        "hq-oci-r2-canary-0123456789-scope",
      ],
      ownedBuckets: [
        "hq-oci-r2-canary-0123456789",
        "hq-oci-r2-canary-0123456789-scope",
      ],
    });
  });

  it("refuses to overwrite an unfinished receipt", async () => {
    const receipt = await receiptPath();
    await writeFile(receipt, "unfinished\n");
    const fetch = successfulFetch();
    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch,
        randomSuffix: () => "0123456789",
        runProcess: vi.fn(),
      }),
    ).rejects.toThrow("recover it before starting another run");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a concurrent run while the receipt path is locked", async () => {
    const receipt = await receiptPath();
    await mkdir(`${receipt}.lock`);
    const fetch = successfulFetch();
    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch,
        randomSuffix: () => "0123456789",
        runProcess: vi.fn(),
      }),
    ).rejects.toThrow("locked by another run");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reclaims a same-host lock whose owner process is gone", async () => {
    const receipt = await receiptPath();
    await mkdir(`${receipt}.lock`);
    await writeFile(
      path.join(`${receipt}.lock`, "owner.json"),
      JSON.stringify({ hostname: hostname(), pid: 999_999_999 }),
    );
    const runProcess = vi.fn(async (request: BrokerProcessRequest) => {
      if (request.arguments[0] === "head" && request.arguments[1]?.endsWith("-scope")) {
        return result(1, "403 Forbidden");
      }
      return result(0);
    });

    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch: successfulFetch(),
        randomSuffix: () => "0123456789",
        runProcess,
      }),
    ).resolves.toEqual({ bucket: "hq-oci-r2-canary-0123456789" });
  });

  it("retains owned buckets when the consumer cannot verify container cleanup", async () => {
    const receipt = await receiptPath();
    const requests: BrokerProcessRequest[] = [];
    const runProcess = vi.fn(async (request: BrokerProcessRequest) => {
      requests.push(request);
      if (request.command === "consumer") return result(75);
      if (request.arguments[0] === "head" && request.arguments[1]?.endsWith("-scope")) {
        return result(1, "403 Forbidden");
      }
      return result(0);
    });

    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch: successfulFetch(),
        randomSuffix: () => "0123456789",
        runProcess,
      }),
    ).rejects.toThrow("containers may still be active; receipt retained");
    expect(requests.some(({ arguments: args }) => args[0] === "purge")).toBe(false);
    expect(JSON.parse(await readFile(receipt, "utf8"))).toMatchObject({
      ownedBuckets: [
        "hq-oci-r2-canary-0123456789",
        "hq-oci-r2-canary-0123456789-scope",
      ],
    });
  });

  it("recovers only the exact buckets recorded by the broker", async () => {
    const receipt = await receiptPath();
    await writeFile(
      receipt,
      JSON.stringify({
        schemaVersion: 1,
        accountId,
        bucketPrefix: "hq-oci-r2-canary",
        plannedBuckets: [
          "hq-oci-r2-canary-0123456789",
          "hq-oci-r2-canary-0123456789-scope",
        ],
        ownedBuckets: [
          "hq-oci-r2-canary-0123456789",
          "hq-oci-r2-canary-0123456789-scope",
        ],
        createdAt: "2026-11-18T12:00:00.000Z",
      }),
    );
    const runProcess = vi.fn(async () => result(0));
    await recoverR2CredentialBroker(
      {
        accountId,
        helperCommand: "r2-helper",
        parentCredentials,
        receiptPath: receipt,
      },
      { fetch: successfulFetch(), runProcess },
    );
    expect(runProcess).toHaveBeenCalledTimes(2);
    await expect(readFile(receipt, "utf8")).rejects.toThrow();
  });

  it("rejects a receipt whose bucket names do not match the generated pair", async () => {
    const receipt = await receiptPath();
    await writeFile(
      receipt,
      JSON.stringify({
        schemaVersion: 1,
        accountId,
        bucketPrefix: "hq-oci-r2-canary",
        plannedBuckets: [
          "hq-oci-r2-canary-production",
          "hq-oci-r2-canary-production-scope",
        ],
        ownedBuckets: ["hq-oci-r2-canary-production"],
        createdAt: "2026-11-18T12:00:00.000Z",
      }),
    );
    const runProcess = vi.fn(async () => result(0));
    await expect(
      recoverR2CredentialBroker(
        {
          accountId,
          helperCommand: "r2-helper",
          parentCredentials,
          receiptPath: receipt,
        },
        { fetch: successfulFetch(), runProcess },
      ),
    ).rejects.toThrow("invalid ownership fields");
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("does not clean a generated name when bucket creation reports a collision", async () => {
    const receipt = await receiptPath();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method !== "POST") throw new Error("unexpected destructive request");
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: "bucket already exists" }],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    });
    const runProcess = vi.fn(async () => result(0));

    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch,
        randomSuffix: () => "0123456789",
        runProcess,
      }),
    ).rejects.toThrow("bucket already exists");
    expect(runProcess).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(readFile(receipt, "utf8")).rejects.toThrow();
  });

  it("cleans only the confirmed bucket when the scope probe name collides", async () => {
    const receipt = await receiptPath();
    let creations = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method === "DELETE") return jsonResponse({});
      if (init?.method === "GET") return jsonResponse(undefined, 404);
      creations += 1;
      if (creations === 1) return jsonResponse({ name: "confirmed" });
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: "scope probe already exists" }],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    });
    const requests: BrokerProcessRequest[] = [];
    const runProcess = vi.fn(async (request: BrokerProcessRequest) => {
      requests.push(request);
      return result(0);
    });

    await expect(
      runR2CredentialBroker(brokerInput(receipt), {
        fetch,
        randomSuffix: () => "0123456789",
        runProcess,
      }),
    ).rejects.toThrow("scope probe already exists");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.arguments).toEqual([
      "purge",
      "hq-oci-r2-canary-0123456789",
    ]);
    await expect(readFile(receipt, "utf8")).rejects.toThrow();
  });
});
