const RETRYABLE_DATABASE_TIMEOUT_CODES = new Set([
  "25P03", // idle_in_transaction_session_timeout
  "25P04", // transaction_timeout
  "55P03", // lock_timeout
  "57014", // statement_timeout or query cancellation
]);

export const isRetryableDatabaseTimeout = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (
    "code" in error &&
    typeof error.code === "string" &&
    RETRYABLE_DATABASE_TIMEOUT_CODES.has(error.code)
  ) {
    return true;
  }
  return "cause" in error && isRetryableDatabaseTimeout(error.cause);
};
