import { createPrivateKey, sign } from "node:crypto";
import type {
  GitHubDeliveryConsumer,
  GitHubReconciliationTarget,
} from "work-graph-db";
import type { GitHubDelivery } from "work-graph-domain";

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_PAGES = 10;

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

export class GitHubReconciliationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

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

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function createGitHubAppJwt(
  appId: string,
  privateKey: string,
  now: Date,
): string {
  if (!/^\d+$/.test(appId)) {
    throw new GitHubReconciliationError("GitHub App ID is invalid.");
  }
  const issuedAt = Math.floor(now.getTime() / 1_000) - 60;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + 600, iss: appId }),
  );
  const unsigned = `${header}.${claims}`;
  let signature: string;
  try {
    signature = base64Url(
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

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const source = value as JsonRecord;
  return `{${Object.keys(source)
    .filter((key) => source[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(",")}}`;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function uuidFromDigest(digest: Uint8Array): string {
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = hex(bytes);
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
  const payloadDigest = await sha256(payloadJson);
  const identityDigest = await sha256(
    canonicalJson({ event: input.event, payload: input.payload }),
  );
  return {
    deliveryId: uuidFromDigest(identityDigest),
    event: input.event,
    installationId: input.installationId,
    payload: input.payload,
    payloadDigest: hex(payloadDigest),
    receivedAt: input.receivedAt,
    repository: input.repository,
  };
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/);
    if (match?.[2] === "next") return match[1] ?? null;
  }
  return null;
}

function repositoryPath(repository: string): string {
  return repository
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function assertGitHubApiUrl(value: string): string {
  const url = new URL(value, GITHUB_API_ORIGIN);
  if (url.origin !== GITHUB_API_ORIGIN) {
    throw new GitHubReconciliationError("GitHub pagination left api.github.com.");
  }
  return url.toString();
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
      environment: status.environment,
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
      const targetDeliveries = await this.fetchTarget(target);
      for (const delivery of targetDeliveries) {
        const disposition = await this.consumer.consume(delivery);
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
    const pullRequest = record(
      await this.request(
        `/repos/${encodedRepository}/pulls/${target.number}`,
        token,
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
        token,
      )),
      ...(await this.fetchDeploymentPayloads(
        encodedRepository,
        repository,
        installationId,
        commits,
        token,
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
    token: string,
  ): Promise<readonly ReconciliationPayload[]> {
    const payloads: ReconciliationPayload[] = [];
    const runIds = new Set<number>();
    for (const commit of commits) {
      const workflowPages = await this.requestPages(
        `/repos/${encodedRepository}/actions/runs?head_sha=${encodeURIComponent(commit)}&status=completed&per_page=100`,
        token,
        (value) => array(record(value, "workflow runs").workflow_runs, "workflow runs"),
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
    token: string,
  ): Promise<readonly ReconciliationPayload[]> {
    const payloads: ReconciliationPayload[] = [];
    const deploymentIds = new Set<number>();
    for (const commit of commits) {
      const deployments = await this.requestPages(
        `/repos/${encodedRepository}/deployments?sha=${encodeURIComponent(commit)}&per_page=100`,
        token,
        (value) => array(value, "deployments"),
      );
      for (const value of deployments) {
        const deployment = record(value, "deployment");
        const deploymentId = positiveInteger(deployment.id, "deployment ID");
        if (deploymentIds.has(deploymentId)) continue;
        deploymentIds.add(deploymentId);
        const statuses = await this.requestPages(
          `/repos/${encodedRepository}/deployments/${deploymentId}/statuses?per_page=100`,
          token,
          (response) => array(response, "deployment statuses"),
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
    const response = await this.fetcher(assertGitHubApiUrl(path), {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "work-graph-observer",
        "x-github-api-version": GITHUB_API_VERSION,
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new GitHubReconciliationError(
        `GitHub API request failed with HTTP ${response.status}.`,
      );
    }
    return response.json() as Promise<unknown>;
  }

  private async requestPages(
    path: string,
    token: string,
    items: (value: unknown) => readonly unknown[],
  ): Promise<readonly unknown[]> {
    const results: unknown[] = [];
    let next: string | null = assertGitHubApiUrl(path);
    for (let page = 0; next !== null && page < MAX_PAGES; page += 1) {
      const response = await this.fetcher(next, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "work-graph-observer",
          "x-github-api-version": GITHUB_API_VERSION,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new GitHubReconciliationError(
          `GitHub API request failed with HTTP ${response.status}.`,
        );
      }
      results.push(...items((await response.json()) as unknown));
      const candidate = nextLink(response.headers.get("link"));
      next = candidate === null ? null : assertGitHubApiUrl(candidate);
    }
    if (next !== null) {
      throw new GitHubReconciliationError(
        `GitHub pagination exceeded ${MAX_PAGES} pages.`,
      );
    }
    return results;
  }
}
