type BoundedReadinessOptions = {
  attempts?: number;
  delayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  warn?: (message: string) => void;
};

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(/\s+/g, " ")
    .slice(0, 500);
}

export async function retryBoundedReadiness<T>(
  description: string,
  operation: (attempt: number) => Promise<T>,
  options: BoundedReadinessOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_000;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError("Readiness attempts must be a positive integer");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new RangeError("Readiness delay must be a non-negative integer");
  }

  const wait = options.wait ?? defaultWait;
  const warn = options.warn ?? console.warn;
  const failures: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      failures.push(`attempt ${attempt}: ${errorSummary(error)}`);
      if (attempt === attempts) {
        throw new Error(
          `${description} failed after ${attempts} attempts (${failures.join("; ")})`,
          { cause: error },
        );
      }
      const nextDelayMs = delayMs * attempt;
      warn(
        `${description} was not ready; retrying after ${nextDelayMs}ms (${failures.at(-1)})`,
      );
      await wait(nextDelayMs);
    }
  }

  throw new Error(`${description} retry loop ended without a result`);
}
