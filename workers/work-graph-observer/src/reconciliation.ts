import { createPrivateKey, sign } from "node:crypto";
import {
  GITHUB_API_URL,
  GITHUB_API_VERSION,
  GithubClient,
  type GithubPageItems,
} from "github-client";
import { bytesToHex, sha256Bytes, sha256Hex } from "ts-base/crypto";
import { canonicalJson } from "ts-base/json";
import { base64UrlEncode } from "ts-base/strings";
import type {
  GitHubDeliveryConsumer,
  GitHubReconciliationTarget,
} from "work-graph-db";
import type { GitHubDelivery } from "work-graph-domain";

const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;
type Disposition = Awaited<ReturnType<GitHubDeliveryConsumer["consume"]>>;
type ReconciliationPayload = { event: string; payload: JsonRecord };

export interface GitHubReconciliationConfig {
  readonly appId: string;
  readonly privateKey: string;
  readonly allowedInstallationIds: ReadonlySet<number>;
  readonly allowedRepositories: ReadonlySet<string>;
}

export interface GitHubReconciliationSummary {
  readonly targets: number;
  readonly deliveries: number;
  readonly processed: number;
  readonly ignored: number;
  readonly unmatched: number;
}

export interface GitHubReconciliationDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export class GitHubReconciliationError extends Error {}

function record(value: unknown, name: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GitHubReconciliationError(`GitHub returned invalid ${name}.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new GitHubReconciliationError(`GitHub returned invalid ${name}.`);
  }
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GitHubReconciliationError(`GitHub returned invalid ${name}.`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new GitHubReconciliationError(`GitHub returned invalid ${name}.`);
  }
  return value;
}

/** Accept GitHub's downloaded RSA key as well as converted PKCS#8 keys. */
export function createGitHubAppJwt(
  appId: string,
  privateKey: string,
  now: Date,
): string {
  if (!/^\d+$/.test(appId)) {
    throw new GitHubReconciliationError("GitHub App ID is invalid.");
  }
  const issuedAt = Math.floor(now.getTime() / 1_000) - 60;
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + 600, iss: appId }),
  );
  const unsigned = `${header}.${claims}`;
  let signature: string;
  try {
    signature = base64UrlEncode(
      sign(
        "RSA-SHA256",
        Buffer.from(unsigned),
        createPrivateKey(privateKey),
      ),
    );
  } catch {
    throw new GitHubReconciliationError("GitHub App private key is invalid.");
  }
  return `${unsigned}.${signature}`;
}

function uuidFromDigest(digest: Uint8Array): string {
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = bytesToHex(bytes);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function reconciliationDelivery(input: {
  readonly event: string;
  readonly installationId: number;
  readonly payload: JsonRecord;
  readonly receivedAt: string;
  readonly repository: string;
}): Promise<GitHubDelivery> {
  const payloadJson = canonicalJson(input.payload);
  const [payloadDigest, identityDigest] = await Promise.all([
    sha256Hex(payloadJson),
    sha256Bytes(canonicalJson({ event: input.event, payload: input.payload })),
  ]);
  return {
    deliveryId: uuidFromDigest(identityDigest),
    event: input.event,
    installationId: input.installationId,
    payload: input.payload,
    payloadDigest,
    receivedAt: input.receivedAt,
    repository: input.repository,
  };
}

function repositoryPath(repository: string): string {
  return repository
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function pullRequestPayload(
  source: JsonRecord,
  repository: string,
  installationId: number,
): JsonRecord {
  const head = record(source.head, "pull request head");
  const state = text(source.state, "pull request state");
  const merged =
    source.merged === true || typeof source.merged_at === "string";
  return {
    action: state === "open" ? "synchronize" : "closed",
    installation: { id: installationId },
    pull_request: {
      number: positiveInteger(source.number, "pull request number"),
      head: { sha: text(head.sha, "pull request head SHA") },
      merge_commit_sha: source.merge_commit_sha,
      state,
      merged,
      draft: source.draft,
      mergeable: source.mergeable,
      html_url: text(source.html_url, "pull request URL"),
      updated_at: text(source.updated_at, "pull request update time"),
    },
    repository: { full_name: repository },
  };
}

function workflowPayload(
  source: JsonRecord,
  repository: string,
  installationId: number,
): JsonRecord {
  return {
    action: "completed",
    installation: { id: installationId },
    repository: { full_name: repository },
    workflow_run: {
      id: positiveInteger(source.id, "workflow run ID"),
      run_attempt: positiveInteger(
        source.run_attempt,
        "workflow run attempt",
      ),
      status: text(source.status, "workflow run status"),
      conclusion: text(source.conclusion, "workflow run conclusion"),
      head_sha: text(source.head_sha, "workflow run head SHA"),
      name: text(source.name, "workflow run name"),
      html_url: text(source.html_url, "workflow run URL"),
      updated_at: text(source.updated_at, "workflow run update time"),
    },
  };
}

function deploymentPayload(
  deployment: JsonRecord,
  status: JsonRecord,
  repository: string,
  installationId: number,
): JsonRecord {
  return {
    action: "created",
    deployment: {
      id: positiveInteger(deployment.id, "deployment ID"),
      sha: text(deployment.sha, "deployment SHA"),
      environment: text(deployment.environment, "deployment environment"),
    },
    deployment_status: {
      id: positiveInteger(status.id, "deployment status ID"),
      state: text(status.state, "deployment status state"),
      environment: status.environment ?? deployment.environment,
      created_at: text(status.created_at, "deployment status creation time"),
      url: text(status.url, "deployment status URL"),
    },
    installation: { id: installationId },
    repository: { full_name: repository },
  };
}

export class GitHubReconciler {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly installationTokens = new Map<number, string>();

  constructor(
    private readonly config: GitHubReconciliationConfig,
    private readonly consumer: Pick<GitHubDeliveryConsumer, "consume">,
    dependencies: GitHubReconciliationDependencies = {},
  ) {
    this.fetcher = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  async reconcile(
    targets: readonly GitHubReconciliationTarget[],
  ): Promise<GitHubReconciliationSummary> {
    const counts: Record<Disposition, number> = {
      processed: 0,
      ignored: 0,
      unmatched: 0,
      failed: 0,
    };
    let deliveries = 0;
    for (const target of targets) {
      // Targets stay serial to bound GitHub API traffic for scheduled runs.
      const targetDeliveries = await this.fetchTarget(target); // NOSONAR
      for (const delivery of targetDeliveries) {
        // The consumer owns one database connection and must remain serial.
        const disposition = await this.consumer.consume(delivery); // NOSONAR
        counts[disposition] += 1;
        deliveries += 1;
      }
    }
    if (counts.failed > 0) {
      throw new GitHubReconciliationError(
        "GitHub reconciliation retained a failed delivery.",
      );
    }
    return {
      targets: targets.length,
      deliveries,
      processed: counts.processed,
      ignored: counts.ignored,
      unmatched: counts.unmatched,
    };
  }

  private async fetchTarget(
    target: GitHubReconciliationTarget,
  ): Promise<readonly GitHubDelivery[]> {
    const repository = target.repository.toLowerCase();
    if (!this.config.allowedRepositories.has(repository)) {
      throw new GitHubReconciliationError(
        `Repository ${repository} is outside observer policy.`,
      );
    }
    const encodedRepository = repositoryPath(repository);
    const jwt = createGitHubAppJwt(
      this.config.appId,
      this.config.privateKey,
      this.now(),
    );
    const installation = record(
      await this.request(
        `/repos/${encodedRepository}/installation`,
        jwt,
      ),
      "installation",
    );
    const installationId = positiveInteger(
      installation.id,
      "installation ID",
    );
    if (!this.config.allowedInstallationIds.has(installationId)) {
      throw new GitHubReconciliationError(
        `Installation ${installationId} is outside observer policy.`,
      );
    }
    const token = await this.installationToken(installationId, jwt);
    const client = new GithubClient(token, {
      userAgent: "work-graph-observer",
      fetch: this.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const pullRequest = record(
      await client.request(
        "GET",
        `/repos/${encodedRepository}/pulls/${target.number}`,
      ),
      "pull request",
    );
    const receivedAt = this.now().toISOString();
    const payloads: ReconciliationPayload[] = [
      {
        event: "pull_request",
        payload: pullRequestPayload(
          pullRequest,
          repository,
          installationId,
        ),
      },
    ];
    const head = record(pullRequest.head, "pull request head");
    const commits = new Set([text(head.sha, "pull request head SHA")]);
    if (
      pullRequest.merged === true ||
      typeof pullRequest.merged_at === "string"
    ) {
      commits.add(text(pullRequest.merge_commit_sha, "pull request merge SHA"));
    }
    payloads.push(
      ...(await this.fetchWorkflowPayloads(
        encodedRepository,
        repository,
        installationId,
        commits,
        client,
      )),
      ...(await this.fetchDeploymentPayloads(
        encodedRepository,
        repository,
        installationId,
        commits,
        client,
      )),
    );
    return Promise.all(
      payloads.map(({ event, payload }) =>
        reconciliationDelivery({
          event,
          installationId,
          payload,
          receivedAt,
          repository,
        }),
      ),
    );
  }

  private async fetchWorkflowPayloads(
    encodedRepository: string,
    repository: string,
    installationId: number,
    commits: ReadonlySet<string>,
    client: GithubClient,
  ): Promise<readonly ReconciliationPayload[]> {
    const payloads: ReconciliationPayload[] = [];
    const runIds = new Set<number>();
    for (const commit of commits) {
      const workflowPages = await this.responsePages( // NOSONAR -- Bound commit requests avoid GitHub API bursts.
        client,
        `/repos/${encodedRepository}/actions/runs`,
        (value) => array(record(value, "workflow runs").workflow_runs, "workflow runs"),
        { head_sha: commit, status: "completed" },
      );
      for (const value of workflowPages) {
        const run = record(value, "workflow run");
        const runId = positiveInteger(run.id, "workflow run ID");
        if (runIds.has(runId)) continue;
        runIds.add(runId);
        payloads.push({
          event: "workflow_run",
          payload: workflowPayload(run, repository, installationId),
        });
      }
    }
    return payloads;
  }

  private async fetchDeploymentPayloads(
    encodedRepository: string,
    repository: string,
    installationId: number,
    commits: ReadonlySet<string>,
    client: GithubClient,
  ): Promise<readonly ReconciliationPayload[]> {
    const payloads: ReconciliationPayload[] = [];
    const deploymentIds = new Set<number>();
    for (const commit of commits) {
      const deployments = await this.arrayPages( // NOSONAR -- Bound commit requests avoid GitHub API bursts.
        client,
        `/repos/${encodedRepository}/deployments`,
        { sha: commit },
      );
      for (const value of deployments) {
        const deployment = record(value, "deployment");
        const deploymentId = positiveInteger(deployment.id, "deployment ID");
        if (deploymentIds.has(deploymentId)) continue;
        deploymentIds.add(deploymentId);
        const statuses = await this.arrayPages( // NOSONAR -- Each deployment is expanded with bounded traffic.
          client,
          `/repos/${encodedRepository}/deployments/${deploymentId}/statuses`,
        );
        for (const statusValue of statuses) {
          payloads.push({
            event: "deployment_status",
            payload: deploymentPayload(
              deployment,
              record(statusValue, "deployment status"),
              repository,
              installationId,
            ),
          });
        }
      }
    }
    return payloads;
  }

  private async installationToken(
    installationId: number,
    jwt: string,
  ): Promise<string> {
    const cached = this.installationTokens.get(installationId);
    if (cached) return cached;
    const response = record(
      await this.request(
        `/app/installations/${installationId}/access_tokens`,
        jwt,
        { method: "POST" },
      ),
      "installation token",
    );
    const token = text(response.token, "installation token");
    this.installationTokens.set(installationId, token);
    return token;
  }

  private async request(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.fetcher(new URL(path, GITHUB_API_URL), {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "work-graph-observer",
        "x-github-api-version": GITHUB_API_VERSION,
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new GitHubReconciliationError(
        `GitHub API request failed with HTTP ${response.status}.`,
      );
    }
    return response.json() as Promise<unknown>;
  }

  private async arrayPages(
    client: GithubClient,
    path: string,
    query?: Record<string, string | number>,
  ): Promise<readonly unknown[]> {
    const result = await client.paginateByPageNumber<unknown>(path, {
      maxPages: MAX_PAGES,
      query,
    });
    if (!result.complete) {
      throw new GitHubReconciliationError(
        `GitHub pagination exceeded ${MAX_PAGES} pages.`,
      );
    }
    return result.items;
  }

  private async responsePages<TResponse>(
    client: GithubClient,
    path: string,
    pageItems: GithubPageItems<TResponse, unknown>,
    query?: Record<string, string | number>,
  ): Promise<readonly unknown[]> {
    const result = await client.paginateResponseByPageNumber(
      path,
      pageItems,
      { maxPages: MAX_PAGES, query },
    );
    if (!result.complete) {
      throw new GitHubReconciliationError(
        `GitHub pagination exceeded ${MAX_PAGES} pages.`,
      );
    }
    return result.items;
  }
}
