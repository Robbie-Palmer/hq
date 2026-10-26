export type PreviewRetryResponse = {
  dispose: () => Promise<void>;
  headers: () => Record<string, string>;
  status: () => number;
};

type TransientRequestOptions = {
  attempts?: number;
  requestTimeoutMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  warn?: (message: string) => void;
};

const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const defaultAttempts = 3;
const defaultRequestTimeoutMs = 15_000;
const maximumRetryDelayMs = 5_000;

function requirePositiveAttempts(attempts: number): void {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError("Preview request attempts must be a positive integer");
  }
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(/\s+/g, " ")
    .slice(0, 500);
}

function retryDelayMs(
  response: PreviewRetryResponse | undefined,
  attempt: number,
): number {
  const retryAfter = response?.headers()["retry-after"]?.trim() ?? "";
  const retryAfterSeconds = Number(retryAfter);
  if (/^\d+$/.test(retryAfter) && Number.isSafeInteger(retryAfterSeconds)) {
    return Math.min(retryAfterSeconds * 1_000, maximumRetryDelayMs);
  }
  return Math.min(500 * 2 ** (attempt - 1), maximumRetryDelayMs);
}

export async function requestWithTransientRetries<
  T extends PreviewRetryResponse,
>(
  label: string,
  request: (timeoutMs: number, attempt: number) => Promise<T>,
  options: TransientRequestOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? defaultAttempts;
  requirePositiveAttempts(attempts);

  const requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs;
  const wait = options.wait ?? defaultWait;
  const warn = options.warn ?? console.warn;
  const failures: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: T | undefined;
    try {
      response = await request(requestTimeoutMs, attempt);
      if (!transientStatuses.has(response.status())) return response;

      failures.push(`attempt ${attempt}: HTTP ${response.status()}`);
      if (attempt === attempts) {
        warn(`${label} exhausted transient retries (${failures.join("; ")})`);
        return response;
      }
    } catch (error) {
      failures.push(`attempt ${attempt}: ${errorSummary(error)}`);
      if (attempt === attempts) {
        throw new Error(
          `${label} failed after ${attempts} attempts (${failures.join("; ")})`,
          { cause: error },
        );
      }
    }

    const delayMs = retryDelayMs(response, attempt);
    warn(
      `${label} hit a transient failure; retrying after ${delayMs}ms (${failures.at(-1)})`,
    );
    await response?.dispose();
    await wait(delayMs);
  }

  throw new Error(`${label} retry loop ended without a response`);
}
