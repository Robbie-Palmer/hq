const RETRYABLE_DATABASE_TIMEOUT_CODES = new Set([
  "25P03", // idle_in_transaction_session_timeout
  "25P04", // transaction_timeout
  "55P03", // lock_timeout
  "57014", // statement_timeout or query cancellation
]);

const RETRYABLE_DATABASE_CAPACITY_CODES = new Set([
  "53300", // too_many_connections
  "57P03", // cannot_connect_now
]);

const HYPERDRIVE_ERROR_CODE = "58000";
const RETRYABLE_HYPERDRIVE_MESSAGES = [
  "Failed to acquire a connection from the pool.",
  "Internal error.",
  "Server connection attempt failed: connection_refused",
] as const;

export type RetryableDatabaseFailure = "capacity" | "infrastructure" | "timeout";

const databaseFailureForError = (
  error: Error,
): RetryableDatabaseFailure | undefined => {
  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code !== undefined && RETRYABLE_DATABASE_TIMEOUT_CODES.has(code)) {
    return "timeout";
  }
  if (code !== undefined && RETRYABLE_DATABASE_CAPACITY_CODES.has(code)) {
    return "capacity";
  }
  if (
    code === HYPERDRIVE_ERROR_CODE &&
    RETRYABLE_HYPERDRIVE_MESSAGES.some((message) =>
      error.message.includes(message),
    )
  ) {
    return error.message.includes(
      "Failed to acquire a connection from the pool.",
    )
      ? "capacity"
      : "infrastructure";
  }
  return undefined;
};

export const classifyRetryableDatabaseFailure = (
  error: unknown,
): RetryableDatabaseFailure | undefined => {
  if (!(error instanceof Error)) return undefined;
  const failure = databaseFailureForError(error);
  if (failure !== undefined) return failure;
  return "cause" in error
    ? classifyRetryableDatabaseFailure(error.cause)
    : undefined;
};

export const isRetryableDatabaseTimeout = (error: unknown): boolean => {
  return classifyRetryableDatabaseFailure(error) === "timeout";
};
