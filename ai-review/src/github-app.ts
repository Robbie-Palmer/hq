import {
  DEFAULT_GITHUB_API_TIMEOUT_MS,
  GithubClient,
  createGithubAppAuth,
  createGithubInstallationToken,
} from "github-client";
import type { Env } from "./env";

export const GITHUB_API_TIMEOUT_MS = DEFAULT_GITHUB_API_TIMEOUT_MS;

type GitHubAppEnv = Pick<
  Env,
  | "AI_REVIEW_APP_ID"
  | "AI_REVIEW_APP_INSTALLATION_ID"
  | "AI_REVIEW_APP_PRIVATE_KEY"
>;

export function createGitHubAppAuth(options: {
  appId: string;
  installationId: string;
  privateKey: string;
}) {
  return createGithubAppAuth(options);
}

export async function createInstallationToken(options: {
  appId: string;
  installationId: string;
  privateKey: string;
}): Promise<string> {
  return createGithubInstallationToken(options);
}

export function githubApiClientFromToken(
  token: string,
  options: { retries?: number } = {},
): GithubClient {
  return new GithubClient(token, {
    userAgent: "personal-site-ai-review/1",
    timeoutMs: GITHUB_API_TIMEOUT_MS,
    retries: options.retries,
  });
}

export async function githubApiClient(
  env: GitHubAppEnv,
  options: { retries?: number } = {},
): Promise<GithubClient> {
  const token = await createInstallationToken({
    appId: env.AI_REVIEW_APP_ID,
    installationId: env.AI_REVIEW_APP_INSTALLATION_ID,
    privateKey: env.AI_REVIEW_APP_PRIVATE_KEY,
  });
  return githubApiClientFromToken(token, options);
}
