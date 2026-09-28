import {
  MARKER,
  completionContent,
  ignored,
  parseModelPayload,
  scoutSchema,
  type ModelResult,
  type ModelStats,
  type ModelUsage,
  type PullRequestReviewContext,
  type ReviewState,
} from "ai-review-domain/reviewer";
import { JsonClient } from "ts-base/http";
import { GithubClient } from "github-client";
import { type OpenAI, openRouterClient } from "openrouter-client";
import { finiteNumber } from "ts-base/numbers";
import { isRecord } from "ts-base/records";
import { primitiveString } from "ts-base/strings";

type JsonObject = Record<string, unknown>;

export interface Settings {
  githubToken: string;
  openRouterKey: string;
  openCodeKey?: string;
  repository: string;
  prNumber: number;
  openRouterScouts: string[];
  openCodeScouts: string[];
  merger: string;
  ignoredAuthors: string[];
  requireZdr: boolean;
}

export interface PullRequest {
  state: string;
  draft: boolean;
  title?: string;
  author_association?: string;
  labels?: Array<{ name?: string }>;
  user: { login: string };
  base?: { sha: string };
  head: { sha: string; ref?: string; repo?: { full_name?: string } };
}

export const DEFAULT_OPENROUTER_SCOUTS = [
  "moonshotai/kimi-k2.6",
  "deepseek/deepseek-v4-pro",
  "z-ai/glm-5.3-flash",
  "inclusionai/ling-2.6-1t",
];
export const OPENROUTER_SCOUT_MAX_PRICES: Record<
  string,
  { prompt: number; completion: number }
> = {
  "moonshotai/kimi-k2.6": { prompt: 0.7, completion: 2.8 },
  "deepseek/deepseek-v4-pro": { prompt: 0.65, completion: 1.3 },
  "z-ai/glm-5.3-flash": { prompt: 0.075, completion: 0.25 },
  "inclusionai/ling-2.6-1t": { prompt: 0.08, completion: 0.65 },
};
export const OPENROUTER_MERGER_MAX_PRICES: Record<
  string,
  { prompt: number; completion: number }
> = {
  "google/gemini-3.7-flash": { prompt: 0.75, completion: 3.75 },
};
export const DEFAULT_MERGER = "google/gemini-3.7-flash";
export const DEFAULT_IGNORED_AUTHORS = ["renovate[bot]", "dependabot[bot]"];
export const MERGER_MAX_TOKENS = 8_000;
export const SCOUT_CONCURRENCY = 4;
export const MAX_OPENROUTER_SCOUTS = 6;
export const MAX_OPENCODE_SCOUTS = 6;

const FREE_SCOUT_EXCEPTIONS = new Set(["big-pickle"]);
const EXCLUDED_FREE_SCOUTS = new Set([
  "deepseek-v4-flash-free",
  "laguna-s-2.1-free",
  "ling-3.0-flash-free",
  "mimo-v2.5-free",
  "north-mini-code-free",
]);

export function isEligibleFreeScoutModelId(model: string): boolean {
  return (
    (model.endsWith("-free") || FREE_SCOUT_EXCEPTIONS.has(model)) &&
    !EXCLUDED_FREE_SCOUTS.has(model)
  );
}

export function selectFreeScoutModels(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("OpenCode model catalogue has no data array");
  }
  return [
    ...new Set(
      payload.data
        .filter(isRecord)
        .flatMap((model) =>
          typeof model.id === "string" ? [model.id] : [],
        )
        .filter(isEligibleFreeScoutModelId),
    ),
  ].slice(0, MAX_OPENCODE_SCOUTS);
}

export function duplicateScoutModels(
  openRouterModels: string[],
  openCodeModels: string[],
): string[] {
  const openCodeSet = new Set(openCodeModels);
  return openRouterModels.filter((model) => openCodeSet.has(model));
}

export function isCreditExhaustion(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = isRecord(error) && typeof error.status === "number"
    ? error.status
    : undefined;
  return (
    /OpenRouter credits exhausted/.test(message) ||
    status === 402 ||
    /failed \(402\)/.test(message) ||
    ((status === 403 || /failed \(403\)/.test(message)) &&
      /(?:key limit exceeded|insufficient credits|out of credits|payment required)/i.test(
        message,
      ))
  );
}

interface ReasoningSettings {
  enabled: boolean;
  exclude: boolean;
}

type OpenRouterCompletionRequest =
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    provider: JsonObject;
    reasoning?: ReasoningSettings;
  };

interface ChangedFile {
  filename: string;
  previous_filename?: string;
  status: string;
  patch?: string;
}

interface ChangedFiles {
  diff: string;
  paths: string[];
  omitted: string[];
}

type FileContent = readonly [path: string, content: string | undefined];

const COST_PATTERN = /<!-- ai-review-cost:(\{[^\n]*\}) -->/;
const BOT_LOGINS = new Set(["github-actions[bot]"]);
const KNOWN_FREE_SCOUTS = ["big-pickle", "nemotron-3-ultra-free"];
const REASONING_DISABLED_MODELS = new Set(["moonshotai/kimi-k2.6"]);
const MAX_DIFF_CHARS = 280_000;
const MAX_PATCH_CHARS = 60_000;
const MAX_CONTEXT_CHARS = 180_000;
const MAX_FILE_CHARS = 40_000;
const MAX_FILE_BYTES = 200_000;
const FILE_CONTEXT_BATCH_SIZE = 20;
const MAX_FILE_CONTEXT_REST_FALLBACKS = 4;
const MAX_GUIDELINES_CHARS = 20_000;
const MAX_THREAD_CHARS = 40_000;
const MAX_COMMENT_CHARS = 60_000;
const SCOUT_MAX_TOKENS = 8_000;
const SCOUT_TIMEOUT_MS = 120_000;
const SCOUT_TIMEOUT_BY_MODEL: Record<string, number> = {
  "nemotron-3-ultra-free": 180_000,
};

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function modelUsage(value: unknown): ModelUsage | undefined {
  if (!isRecord(value)) return undefined;
  const promptDetails = isRecord(value.prompt_tokens_details)
    ? value.prompt_tokens_details
    : {};
  const inputTokens = finiteNumber(value.prompt_tokens);
  const outputTokens = finiteNumber(value.completion_tokens);
  const cachedInputTokens = finiteNumber(promptDetails.cached_tokens);
  if (inputTokens === 0 && outputTokens === 0 && cachedInputTokens === 0) {
    return undefined;
  }
  return { inputTokens, outputTokens, cachedInputTokens };
}

function reviewerLogins(reviewConnection: unknown): string[] {
  if (!isRecord(reviewConnection) || !Array.isArray(reviewConnection.nodes)) return [];
  const logins = reviewConnection.nodes.flatMap((review) => {
    if (!isRecord(review) || !isRecord(review.author)) return [];
    const login = textValue(review.author.login);
    return login ? [login] : [];
  });
  return [...new Set(logins)].sort((left, right) => left.localeCompare(right));
}

function reviewThreadState(value: JsonObject): "RESOLVED" | "OUTDATED" | "OPEN" {
  if (value.isResolved === true) return "RESOLVED";
  if (value.isOutdated === true) return "OUTDATED";
  return "OPEN";
}

function reviewCommentLine(comment: JsonObject): string {
  const author = isRecord(comment.author) ? textValue(comment.author.login, "unknown") : "unknown";
  const path = textValue(comment.path, "?");
  const line = primitiveString(comment.line, "?");
  const body = textValue(comment.body).slice(0, 1_500);
  return `${author} at ${path}:${line}: ${body}`;
}

function reviewThreadBlock(
  value: unknown,
  relevantPaths: ReadonlySet<string> | undefined,
): string | undefined {
  if (!isRecord(value) || !isRecord(value.comments) || !Array.isArray(value.comments.nodes)) {
    return undefined;
  }
  const comments = value.comments.nodes
    .filter(isRecord)
    .filter((comment) => !relevantPaths || relevantPaths.has(textValue(comment.path)))
    .map(reviewCommentLine);
  if (comments.length === 0) return undefined;
  return `THREAD ${reviewThreadState(value)}\n${comments.join("\n")}\nEND THREAD`;
}

function orderedChangedFiles(
  files: ChangedFile[],
  includeIgnored: boolean,
): ChangedFile[] {
  const reviewable = files.filter(({ filename }) => !ignored(filename));
  if (!includeIgnored) return reviewable;
  return [
    ...reviewable,
    ...files.filter(({ filename }) => ignored(filename)),
  ];
}

function changedFileDiff(file: ChangedFile): string | undefined {
  if (typeof file.patch !== "string" || file.patch.length > MAX_PATCH_CHARS) {
    return undefined;
  }
  const previousPath = file.previous_filename ?? file.filename;
  return `diff --git a/${previousPath} b/${file.filename}\nstatus ${file.status}\n${file.patch}\n`;
}

function boundedDiff(files: ChangedFile[]): ChangedFiles {
  const blocks: string[] = [];
  const paths: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const file of files) {
    const block = changedFileDiff(file);
    if (!block || used + block.length > MAX_DIFF_CHARS) {
      omitted.push(file.filename);
      continue;
    }
    blocks.push(block);
    paths.push(file.filename);
    used += block.length;
  }
  return { diff: blocks.join(""), paths, omitted };
}

function repositoryCoordinates(repository: string): {
  owner: string;
  name: string;
} {
  const [owner, name] = repository.split("/", 2);
  if (!owner || !name) throw new Error(`Invalid GitHub repository ${repository}`);
  return { owner, name };
}

function fileContextGraphql(paths: string[]): string {
  const variableDefinitions = paths
    .map((_, index) => `$expression${index}: String!`)
    .join(", ");
  const selections = paths
    .map(
      (_, index) =>
        `file${index}: object(expression: $expression${index}) {
          ... on Blob { byteSize isBinary isTruncated text }
        }`,
    )
    .join("\n");
  return `query FileContext(
    $owner: String!
    $repository: String!
    ${variableDefinitions}
  ) {
    repository(owner: $owner, name: $repository) {
      ${selections}
    }
  }`;
}

function fileContextVariables(
  paths: string[],
  headSha: string,
  repository: string,
): JsonObject {
  const { owner, name } = repositoryCoordinates(repository);
  const expressions = Object.fromEntries(
    paths.map((path, index) => [`expression${index}`, `${headSha}:${path}`]),
  );
  return { owner, repository: name, ...expressions };
}

function fileContentFromBlob(blob: unknown): string | undefined {
  if (
    !isRecord(blob) ||
    blob.isBinary === true ||
    blob.isTruncated === true ||
    Number(blob.byteSize ?? 0) > MAX_FILE_BYTES ||
    typeof blob.text !== "string"
  ) {
    return undefined;
  }
  return blob.text;
}

function fileContentsFromGraphql(
  payload: JsonObject,
  paths: string[],
): FileContent[] {
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(
      `GitHub file-context GraphQL errors: ${JSON.stringify(payload.errors).slice(0, 1_000)}`,
    );
  }
  const data = payload.data;
  if (!isRecord(data) || !isRecord(data.repository)) {
    throw new Error("GitHub file-context GraphQL response has no repository");
  }
  const repository = data.repository;
  return paths.map((path, index) => [
    path,
    fileContentFromBlob(repository[`file${index}`]),
  ] as const);
}

function appendFileContext(
  blocks: string[],
  contents: FileContent[],
  used: number,
): { used: number; full: boolean } {
  for (const [path, raw] of contents) {
    if (!raw) continue;
    const content = raw.slice(0, MAX_FILE_CHARS);
    const block = `FILE ${path}\n${content}\nEND FILE ${path}\n`;
    if (used + block.length > MAX_CONTEXT_CHARS) return { used, full: true };
    blocks.push(block);
    used += block.length;
  }
  return { used, full: false };
}

function openRouterProvider(
  maxPrice: { prompt: number; completion: number } | undefined,
  requireZdr: boolean,
): JsonObject {
  return {
    allow_fallbacks: true,
    require_parameters: true,
    ...(maxPrice ? { max_price: maxPrice } : {}),
    ...(requireZdr ? { zdr: true, data_collection: "deny" } : {}),
  };
}

function modelResult(response: unknown, model: string): ModelResult {
  if (!isRecord(response)) throw new Error(`Invalid response from ${model}`);
  const choices = response.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) {
    throw new Error(`Invalid response from ${model}`);
  }
  const usage = isRecord(response.usage) ? response.usage : {};
  return {
    payload: parseModelPayload(completionContent(choices[0], model)),
    cost: finiteNumber(response.cost ?? usage.cost),
    usage: modelUsage(usage),
  };
}

function reviewState(body: string): ReviewState {
  const state: ReviewState = { runs: 0, total_usd: 0 };
  const match = COST_PATTERN.exec(body);
  if (!match) return state;
  try {
    const stored = JSON.parse(match[1] ?? "{}") as JsonObject;
    state.runs = Number(stored.runs ?? 0);
    state.total_usd = Number(stored.total_usd ?? 0);
    if (isRecord(stored.models)) {
      state.models = stored.models as unknown as Record<string, ModelStats>;
    }
  } catch {
    // A malformed historical marker should not block a fresh review.
  }
  return state;
}

function matchingReviewComment(
  comments: JsonObject[],
  marker: string,
  botLogins: ReadonlySet<string>,
): { body: string; id: number; state: ReviewState } | undefined {
  for (const comment of comments) {
    const user = isRecord(comment.user) ? comment.user : {};
    const body = textValue(comment.body);
    if (!botLogins.has(textValue(user.login)) || !body.includes(marker)) continue;
    return { body, id: Number(comment.id), state: reviewState(body) };
  }
  return undefined;
}

function pullRequestData(payload: JsonObject): JsonObject | undefined {
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(
      `GitHub GraphQL errors: ${JSON.stringify(payload.errors).slice(0, 1_000)}`,
    );
  }
  const data = payload.data;
  if (!isRecord(data) || !isRecord(data.repository)) return undefined;
  return isRecord(data.repository.pullRequest)
    ? data.repository.pullRequest
    : undefined;
}

function boundedReviewThreads(
  connection: unknown,
  relevantPaths: ReadonlySet<string> | undefined,
): string {
  if (!isRecord(connection) || !Array.isArray(connection.nodes)) return "";
  const blocks: string[] = [];
  let used = 0;
  for (const value of connection.nodes) {
    const block = reviewThreadBlock(value, relevantPaths);
    if (!block) continue;
    if (used + block.length > MAX_THREAD_CHARS) break;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join("\n\n");
}

export class Reviewer {
  private readonly github: GithubClient;
  private readonly openCode: JsonClient;
  private readonly openRouter: OpenAI;
  private readonly settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
    const common = { "Content-Type": "application/json", "User-Agent": "personal-site-ai-review/1" };
    this.github = new GithubClient(settings.githubToken, {
      userAgent: "personal-site-ai-review/1",
    });
    this.openCode = new JsonClient(
      "https://opencode.ai/zen/v1",
      {
        ...common,
        ...(settings.openCodeKey ? { Authorization: `Bearer ${settings.openCodeKey}` } : {}),
      },
      { timeoutMs: SCOUT_TIMEOUT_MS, retries: 2 },
    );
    // Completion POSTs have no provider idempotency key. Retrying after a
    // timeout or 5xx can duplicate a completion that the provider accepted.
    this.openRouter = openRouterClient(settings.openRouterKey, {
      maxRetries: 0,
    });
  }

  private get prPath(): string {
    return `/repos/${this.settings.repository}/pulls/${this.settings.prNumber}`;
  }

  getPr(): Promise<PullRequest> {
    return this.github.request("GET", this.prPath);
  }

  private async pages<T>(path: string, limit?: number): Promise<T[]> {
    const result = await this.github.paginate<T>(path, { maxPages: limit });
    return result.items;
  }

  async changedFiles(
    options: { includeIgnored?: boolean } = {},
  ): Promise<ChangedFiles> {
    const files = await this.pages<ChangedFile>(`${this.prPath}/files`, 30);
    // Forced reviews may include ignored files, but process those files only
    // after every normally reviewable patch has had access to the bounded diff
    // budget. A large lockfile or generated patch must never displace source.
    return boundedDiff(orderedChangedFiles(files, options.includeIgnored ?? false));
  }

  private async fileContent(path: string, headSha: string): Promise<string | undefined> {
    try {
      const payload = await this.github.request<JsonObject>(
        "GET",
        `/repos/${this.settings.repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
        { query: { ref: headSha } },
      );
      if (payload.encoding !== "base64" || Number(payload.size ?? 0) > MAX_FILE_BYTES || typeof payload.content !== "string") {
        return undefined;
      }
      const bytes = Uint8Array.from(
        atob(payload.content.replace(/\s/g, "")),
        (character) => character.codePointAt(0) ?? 0,
      );
      return new TextDecoder().decode(bytes);
    } catch (error) {
      if (error instanceof Error && error.message.includes("(404)")) return undefined;
      throw error;
    }
  }

  private async fileContentBatch(
    paths: string[],
    headSha: string,
  ): Promise<FileContent[]> {
    const payload = await this.github.request<JsonObject>("POST", "/graphql", {
      body: {
        query: fileContextGraphql(paths),
        variables: fileContextVariables(
          paths,
          headSha,
          this.settings.repository,
        ),
      },
    });
    return fileContentsFromGraphql(payload, paths);
  }

  private async fallbackFileContents(
    paths: string[],
    headSha: string,
  ): Promise<FileContent[]> {
    return Promise.all(
      paths.map(async (path) => {
        try {
          return [path, await this.fileContent(path, headSha)] as const;
        } catch (error) {
          console.error(`::warning::Could not fetch ${path}: ${String(error)}`);
          return [path, undefined] as const;
        }
      }),
    );
  }

  private async contextBatch(
    paths: string[],
    headSha: string,
    remainingFallbacks: number,
  ): Promise<{ contents: FileContent[]; fallbacksUsed: number }> {
    try {
      return {
        contents: await this.fileContentBatch(paths, headSha),
        fallbacksUsed: 0,
      };
    } catch (error) {
      console.error(
        `::warning::Could not batch GitHub file context: ${String(error)}`,
      );
      const fallbackPaths = paths.slice(0, remainingFallbacks);
      const skipped = paths.length - fallbackPaths.length;
      if (skipped > 0) {
        console.error(
          `::warning::Skipped ${skipped} file-context path(s) after the REST fallback limit was exhausted`,
        );
      }
      return {
        contents: await this.fallbackFileContents(fallbackPaths, headSha),
        fallbacksUsed: fallbackPaths.length,
      };
    }
  }

  async fileContext(paths: string[], headSha: string): Promise<string> {
    const blocks: string[] = [];
    let used = 0;
    let remainingFallbacks = MAX_FILE_CONTEXT_REST_FALLBACKS;
    for (
      let offset = 0;
      offset < paths.length && used < MAX_CONTEXT_CHARS;
      offset += FILE_CONTEXT_BATCH_SIZE
    ) {
      const batchPaths = paths.slice(offset, offset + FILE_CONTEXT_BATCH_SIZE);
      const batch = await this.contextBatch(
        batchPaths,
        headSha,
        remainingFallbacks,
      );
      remainingFallbacks -= batch.fallbacksUsed;
      const appended = appendFileContext(blocks, batch.contents, used);
      used = appended.used;
      if (appended.full) return blocks.join("\n");
    }
    return blocks.join("\n");
  }

  async headGuidelines(headSha: string): Promise<string> {
    for (const path of ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"]) {
      const content = await this.fileContent(path, headSha);
      if (content !== undefined) return content.slice(0, MAX_GUIDELINES_CHARS);
    }
    return "";
  }

  async openCodeScoutModels(): Promise<{ models: string[]; unavailable: string[] }> {
    let available: string[];
    try {
      available = selectFreeScoutModels(await this.openCode.request<JsonObject>("GET", "/models"));
    } catch (error) {
      console.error(`::warning::Could not refresh OpenCode free models; using configured fallback: ${String(error)}`);
      return {
        models: this.settings.openCodeScouts.length ? this.settings.openCodeScouts : KNOWN_FREE_SCOUTS,
        unavailable: [],
      };
    }
    if (!this.settings.openCodeScouts.length) {
      if (!available.length) console.error("::warning::OpenCode currently advertises no eligible free scout models");
      return { models: available, unavailable: [] };
    }
    const availableSet = new Set(available);
    return {
      models: this.settings.openCodeScouts.filter((model) => availableSet.has(model)),
      unavailable: this.settings.openCodeScouts.filter((model) => !availableSet.has(model)),
    };
  }

  async callOpenCodeScout(
    model: string,
    system: string,
    user: string,
    options: { maxTokens?: number; timeoutMs?: number } = {},
  ): Promise<ModelResult> {
    const response = await this.openCode.request<JsonObject>("POST", "/chat/completions", {
      body: {
        model,
        temperature: 0,
        max_tokens: options.maxTokens ?? SCOUT_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `${system}\n\nOUTPUT JSON SCHEMA:\n${JSON.stringify(scoutSchema)}`,
          },
          { role: "user", content: user },
        ],
      },
      timeoutMs: options.timeoutMs ?? SCOUT_TIMEOUT_BY_MODEL[model] ?? SCOUT_TIMEOUT_MS,
    });
    return modelResult(response, model);
  }

  async callOpenRouterScout(
    model: string,
    system: string,
    user: string,
    options: { maxTokens?: number; timeoutMs?: number } = {},
  ): Promise<ModelResult> {
    const reasoning: ReasoningSettings | undefined = REASONING_DISABLED_MODELS.has(model)
      ? { enabled: false, exclude: true }
      : undefined;
    const response = await this.openRouter.chat.completions.create(
      {
        model,
        temperature: 0,
        max_tokens: options.maxTokens ?? SCOUT_MAX_TOKENS,
        provider: openRouterProvider(
          OPENROUTER_SCOUT_MAX_PRICES[model],
          this.settings.requireZdr,
        ),
        ...(reasoning ? { reasoning } : {}),
        response_format: {
          type: "json_schema",
          json_schema: { name: "code_review_findings", strict: true, schema: scoutSchema },
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      } as OpenRouterCompletionRequest,
      options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs },
    );
    return modelResult(response, model);
  }

  async callMerger(
    model: string,
    system: string,
    user: string,
    schemaName: string,
    schema: JsonObject,
    maxTokens: number,
    timeoutMs?: number,
  ): Promise<ModelResult> {
    const response = await this.openRouter.chat.completions.create(
      {
        model,
        temperature: 0,
        max_tokens: maxTokens,
        provider: openRouterProvider(
          OPENROUTER_MERGER_MAX_PRICES[model],
          this.settings.requireZdr,
        ),
        response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      } as OpenRouterCompletionRequest,
      timeoutMs === undefined ? {} : { timeout: timeoutMs },
    );
    return modelResult(response, model);
  }

  async existingComment(
    marker = MARKER,
    botLogins: ReadonlySet<string> = BOT_LOGINS,
  ): Promise<{ body?: string; id?: number; state: ReviewState }> {
    const comments = await this.pages<JsonObject>(
      `/repos/${this.settings.repository}/issues/${this.settings.prNumber}/comments`,
    );
    return matchingReviewComment(comments, marker, botLogins) ?? {
      state: { runs: 0, total_usd: 0 },
    };
  }

  async pullRequestReviewContext(paths?: string[]): Promise<PullRequestReviewContext> {
    const relevantPaths = paths ? new Set(paths) : undefined;
    const { owner, name: repository } = repositoryCoordinates(
      this.settings.repository,
    );
    const query = `query($owner:String!, $repository:String!, $number:Int!) {
      repository(owner:$owner, name:$repository) {
        pullRequest(number:$number) {
          reviews(first:100) { nodes { author { login } } }
          reviewThreads(first:100) {
            nodes { isResolved isOutdated comments(first:20) { nodes { path line body author { login } } } }
          }
        }
      }
    }`;
    const payload = await this.github.request<JsonObject>("POST", "/graphql", {
      body: { query, variables: { owner, repository, number: this.settings.prNumber } },
    });
    const pullRequest = pullRequestData(payload);
    if (!pullRequest) return { threads: "", reviewers: [] };
    const reviewers = reviewerLogins(pullRequest.reviews);
    return {
      threads: boundedReviewThreads(pullRequest.reviewThreads, relevantPaths),
      reviewers,
    };
  }

  async reviewThreadContext(paths?: string[]): Promise<string> {
    return (await this.pullRequestReviewContext(paths)).threads;
  }

  async writeComment(id: number | undefined, body: string): Promise<number | undefined> {
    const safeBody =
      body.length <= MAX_COMMENT_CHARS ? body : `${body.slice(0, MAX_COMMENT_CHARS - 100)}\n\n_Comment truncated._\n`;
    if (id) {
      await this.github.request("PATCH", `/repos/${this.settings.repository}/issues/comments/${id}`, {
        body: { body: safeBody },
      });
      return id;
    } else {
      const comment = await this.github.request<JsonObject>(
        "POST",
        `/repos/${this.settings.repository}/issues/${this.settings.prNumber}/comments`,
        { body: { body: safeBody }, retries: 1 },
      );
      const commentId = Number(comment.id);
      return Number.isSafeInteger(commentId) ? commentId : undefined;
    }
  }
}
