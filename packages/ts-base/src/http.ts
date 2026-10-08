export interface JsonRequestOptions {
  query?: Record<string, string | number>;
  body?: unknown;
  accept?: string;
  timeoutMs?: number;
  retries?: number;
}

export interface JsonClientOptions {
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

export interface FetchWithRetryOptions {
  attempts?: number;
  fetch?: typeof fetch;
  init?: RequestInit;
  retryable?: (response: Response) => boolean;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_RETRIES = 3;
const IDEMPOTENT_METHODS = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PUT"]);
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

const defaultRetryableResponse = (response: Response): boolean =>
  response.status === 429 || response.status >= 500;

export async function fetchWithRetry(
  input: RequestInfo | URL,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? 3;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError("Fetch attempts must be a positive integer");
  }
  const fetchImpl = options.fetch ?? fetch;
  const retryable = options.retryable ?? defaultRetryableResponse;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(input, options.init);
      if (!retryable(response) || attempt === attempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw requestError(error);
    }
  }
  throw requestError(lastError ?? "Fetch retry loop ended without a response");
}

function webCryptoRandom(): number {
  const sample = new Uint32Array(1);
  crypto.getRandomValues(sample);
  return (sample[0] ?? 0) / 2 ** 32;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(
  attempt: number,
  now: () => number,
  random: () => number,
  retryAfter?: string | null,
): number {
  const value = retryAfter?.trim() ?? "";
  const seconds = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(seconds)) {
    return seconds * 1_000 + random() * 1_000;
  }
  const retryAt = Date.parse(value);
  if (value && Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - now()) + random() * 1_000;
  }
  return Math.min(2 ** attempt * 1_000 + random() * 1_000, 15_000);
}

function requestError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

type RequestAttempt<T> =
  | { complete: true; value: T }
  | { complete: false; retryAfter: string | null };

function requestUrl(
  baseUrl: string,
  path: string,
  query: Record<string, string | number> | undefined,
): URL {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

function shouldStopRetrying(
  error: Error,
  attempt: number,
  retries: number,
): boolean {
  return attempt === retries - 1 || /failed \(4\d\d\)/.test(error.message);
}

export class JsonClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;

  constructor(
    baseUrl: string,
    headers: Record<string, string>,
    options: JsonClientOptions = {},
  ) {
    this.#baseUrl = baseUrl;
    this.#headers = headers;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#retries = options.retries ?? DEFAULT_RETRIES;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? webCryptoRandom;
    this.#wait = options.wait ?? defaultWait;
  }

  async request<T>(
    method: string,
    path: string,
    options: JsonRequestOptions = {},
  ): Promise<T> {
    const retries =
      options.retries ??
      (IDEMPOTENT_METHODS.has(method.toUpperCase()) ? this.#retries : 1);
    const url = requestUrl(this.#baseUrl, path, options.query);
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const result = await this.#requestOnce<T>(
          method,
          path,
          url,
          options,
          attempt,
          retries,
        );
        if (result.complete) return result.value;
        await this.#wait(
          retryDelay(attempt, this.#now, this.#random, result.retryAfter),
        );
      } catch (error) {
        lastError = requestError(error);
        if (shouldStopRetrying(lastError, attempt, retries)) throw lastError;
        await this.#wait(retryDelay(attempt, this.#now, this.#random));
      }
    }
    throw lastError ?? new Error(`${method} ${path} failed`);
  }

  async #requestOnce<T>(
    method: string,
    path: string,
    url: URL,
    options: JsonRequestOptions,
    attempt: number,
    retries: number,
  ): Promise<RequestAttempt<T>> {
    const response = await this.#fetch(url, {
      method,
      headers: {
        ...this.#headers,
        ...(options.accept ? { Accept: options.accept } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? this.#timeoutMs),
    });
    if (response.ok) {
      const raw = await response.text();
      return { complete: true, value: (raw ? JSON.parse(raw) : undefined) as T };
    }

    const detail = (await response.text()).slice(0, 1_000);
    if (!RETRYABLE_HTTP_STATUSES.has(response.status) || attempt === retries - 1) {
      throw new Error(`${method} ${path} failed (${response.status}): ${detail}`);
    }
    return {
      complete: false,
      retryAfter: response.headers.get("retry-after"),
    };
  }
}
