import type { R2TemporaryCredentials } from "./r2-broker-types.js";

const cloudflareApiOrigin = "https://api.cloudflare.com";

type CloudflareResponse<T> = {
  success?: boolean;
  result?: T;
  errors?: readonly { message?: unknown }[];
};

export class CloudflareR2RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function apiError<T>(response: Response, payload: CloudflareResponse<T>): Error {
  const messages = (payload.errors ?? [])
    .map(({ message }) => (typeof message === "string" ? message : ""))
    .filter(Boolean)
    .join("; ");
  return new CloudflareR2RequestError(
    response.status,
    `Cloudflare R2 request failed (${response.status})${messages ? `: ${messages}` : ""}`,
  );
}

export class CloudflareR2AdminClient {
  readonly #accountId: string;
  readonly #apiToken: string;
  readonly #fetch: typeof fetch;

  constructor(accountId: string, apiToken: string, fetchImplementation: typeof fetch) {
    this.#accountId = accountId;
    this.#apiToken = apiToken;
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  async #request<T>(
    method: "DELETE" | "GET" | "POST",
    pathname: string,
    body?: unknown,
    allowNotFound = false,
  ): Promise<T | undefined> {
    const response = await this.#fetch(`${cloudflareApiOrigin}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#apiToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allowNotFound && response.status === 404) return undefined;
    let payload: CloudflareResponse<T>;
    try {
      payload = (await response.json()) as CloudflareResponse<T>;
    } catch {
      throw new Error(`Cloudflare R2 request returned invalid JSON (${response.status})`);
    }
    if (!response.ok || payload.success !== true) throw apiError(response, payload);
    return payload.result;
  }

  async createBucket(bucket: string): Promise<void> {
    await this.#request(
      "POST",
      `/client/v4/accounts/${this.#accountId}/r2/buckets`,
      { name: bucket },
    );
  }

  async deleteBucket(bucket: string): Promise<void> {
    await this.#request(
      "DELETE",
      `/client/v4/accounts/${this.#accountId}/r2/buckets/${encodeURIComponent(bucket)}`,
      undefined,
      true,
    );
  }

  async bucketExists(bucket: string): Promise<boolean> {
    const result = await this.#request<Record<string, unknown>>(
      "GET",
      `/client/v4/accounts/${this.#accountId}/r2/buckets/${encodeURIComponent(bucket)}`,
      undefined,
      true,
    );
    return result !== undefined;
  }

  async createTemporaryCredentials(
    bucket: string,
    parentAccessKeyId: string,
    ttlSeconds: number,
  ): Promise<R2TemporaryCredentials> {
    const result = await this.#request<Record<string, unknown>>(
      "POST",
      `/client/v4/accounts/${this.#accountId}/r2/temp-access-credentials`,
      {
        bucket,
        parentAccessKeyId,
        permission: "object-read-write",
        ttlSeconds,
      },
    );
    if (!result) throw new Error("Cloudflare returned no temporary credentials");
    return {
      accessKeyId: requiredString(result.accessKeyId, "temporary accessKeyId"),
      secretAccessKey: requiredString(
        result.secretAccessKey,
        "temporary secretAccessKey",
      ),
      sessionToken: requiredString(result.sessionToken, "temporary sessionToken"),
    };
  }
}
