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
  const runAttempt = async (
    attempt: number,
    failures: readonly string[],
  ): Promise<T> => {
    try {
      return await operation(attempt);
    } catch (error) {
      const nextFailures = [
        ...failures,
        `attempt ${attempt}: ${errorSummary(error)}`,
      ];
      if (attempt === attempts) {
        throw new Error(
          `${description} failed after ${attempts} attempts (${nextFailures.join("; ")})`,
          { cause: error },
        );
      }
      const nextDelayMs = delayMs * attempt;
      warn(
        `${description} was not ready; retrying after ${nextDelayMs}ms (${nextFailures.at(-1)})`,
      );
      await wait(nextDelayMs);
      return runAttempt(attempt + 1, nextFailures);
    }
  };

  return runAttempt(1, []);
}
