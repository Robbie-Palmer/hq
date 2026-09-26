export const EXIT_CODES = {
  success: 0,
  usage: 2,
  authentication: 3,
  notFound: 4,
  conflict: 5,
  validation: 6,
  server: 7,
  transport: 8,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly details?: unknown;
  readonly status?: number;

  constructor(
    code: string,
    message: string,
    exitCode: ExitCode,
    options: { cause?: unknown; details?: unknown; status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = options.details;
    this.status = options.status;
  }
}

export const usageError = (message: string, details?: unknown): CliError =>
  new CliError("CLI_USAGE", message, EXIT_CODES.usage, { details });

export const exitCodeForStatus = (status: number): ExitCode => {
  if (status === 401 || status === 403) return EXIT_CODES.authentication;
  if (status === 404) return EXIT_CODES.notFound;
  if (status === 409) return EXIT_CODES.conflict;
  if (status === 400 || status === 422) return EXIT_CODES.validation;
  if (status >= 500) return EXIT_CODES.server;
  return EXIT_CODES.transport;
};

export const errorDocument = (error: CliError): Record<string, unknown> => ({
  error: {
    code: error.code,
    message: error.message,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.details === undefined ? {} : { details: error.details }),
  },
});
