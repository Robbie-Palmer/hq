import { createAppAuth } from "@octokit/auth-app";
import { request as octokitRequest } from "@octokit/request";
import { JsonClient, type JsonClientOptions } from "ts-base/http";

export const GITHUB_API_URL = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const DEFAULT_GITHUB_API_TIMEOUT_MS = 10_000;
const PKCS8_HEADER = "-----BEGIN PRIVATE KEY-----";

export interface GithubAppOptions {
  appId: string;
  installationId: string;
  privateKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createGithubAppAuth(options: GithubAppOptions) {
  if (!options.privateKey.trimStart().startsWith(PKCS8_HEADER)) {
    throw new Error(
      "GitHub App private key must be unencrypted PKCS#8 PEM; convert GitHub's PKCS#1 download before deployment",
    );
  }
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GITHUB_API_TIMEOUT_MS;
  const request = octokitRequest.defaults({
    request: {
      fetch: (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) =>
        fetchImpl(input, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        }),
    },
  });
  return createAppAuth({
    appId: options.appId,
    installationId: Number(options.installationId),
    privateKey: options.privateKey,
    request,
  });
}

export async function createGithubInstallationToken(
  options: GithubAppOptions,
): Promise<string> {
  const authentication = await createGithubAppAuth(options)({
    type: "installation",
  });
  return authentication.token;
}

export interface GithubClientOptions extends JsonClientOptions {
  userAgent: string;
}

export interface GithubPaginationOptions {
  perPage?: number;
  maxPages?: number;
  query?: Record<string, string | number>;
}

export interface GithubPaginatedResult<T> {
  items: T[];
  pages: number;
  complete: boolean;
}

function paginationBounds(options: GithubPaginationOptions): {
  perPage: number;
  maxPages: number;
} {
  const perPage = options.perPage ?? 100;
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    throw new RangeError("perPage must be an integer between 1 and 100");
  }
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  if (
    maxPages !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxPages) || maxPages < 1)
  ) {
    throw new RangeError("maxPages must be a positive integer or Infinity");
  }
  return { perPage, maxPages };
}

export class GithubClient extends JsonClient {
  constructor(token: string, options: GithubClientOptions) {
    const { userAgent, ...clientOptions } = options;
    super(
      GITHUB_API_URL,
      {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      clientOptions,
    );
  }

  /** Paginates endpoints documented to support GitHub's page/per_page parameters. */
  async paginateByPageNumber<T>(
    path: string,
    options: GithubPaginationOptions = {},
  ): Promise<GithubPaginatedResult<T>> {
    const { perPage, maxPages } = paginationBounds(options);
    const items: T[] = [];
    let pages = 0;
    while (pages < maxPages) {
      const page = await this.request<T[]>("GET", path, {
        query: {
          ...options.query,
          per_page: perPage,
          page: pages + 1,
        },
      });
      if (!Array.isArray(page)) {
        throw new TypeError("GitHub paginated endpoint must return an array");
      }
      items.push(...page);
      pages += 1;
      if (page.length < perPage) return { items, pages, complete: true };
    }
    return { items, pages, complete: false };
  }
}
