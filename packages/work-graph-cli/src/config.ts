import { CliError, EXIT_CODES, usageError } from "./errors.js";

export interface GlobalOptions {
  apiUrl?: string;
  accessAllowedOrigins: string[];
}

export interface WorkGraphClientConfig {
  apiUrl: URL;
  accessHeaders: Readonly<Record<string, string>>;
}

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]";

const parseSecureUrl = (input: string, label: string): URL => {
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new CliError(
      "CLI_CONFIG",
      `${label} must be an absolute HTTP or HTTPS URL.`,
      EXIT_CODES.usage,
      { cause },
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw usageError(`${label} must use HTTP or HTTPS.`);
  }
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw usageError(`${label} must use HTTPS unless it targets loopback.`);
  }
  if (url.username || url.password) {
    throw usageError(`${label} must not contain credentials.`);
  }
  return url;
};

const parseAllowedOrigin = (input: string): string => {
  const url = parseSecureUrl(input.trim(), "A trusted Access origin");
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw usageError(
      `Trusted Access origin ${JSON.stringify(input)} must contain only a URL origin.`,
    );
  }
  return url.origin;
};

const splitOrigins = (input: string | undefined): string[] =>
  input
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

export const resolveClientConfig = (
  options: GlobalOptions,
  environment: NodeJS.ProcessEnv,
): WorkGraphClientConfig => {
  const apiUrlInput = options.apiUrl ?? environment.WORK_GRAPH_API_URL;
  if (!apiUrlInput) {
    throw usageError(
      "Work Graph is not configured. Install and authenticate the Doppler CLI, or set WORK_GRAPH_API_URL.",
    );
  }

  const apiUrl = parseSecureUrl(apiUrlInput, "The Work Graph API URL");
  if (apiUrl.search || apiUrl.hash) {
    throw usageError("The Work Graph API URL must not contain a query or fragment.");
  }
  if (!apiUrl.pathname.endsWith("/")) apiUrl.pathname += "/";

  const workGraphClientId = environment.WORK_GRAPH_CF_ACCESS_CLIENT_ID;
  const workGraphClientSecret = environment.WORK_GRAPH_CF_ACCESS_CLIENT_SECRET;
  if (Boolean(workGraphClientId) !== Boolean(workGraphClientSecret)) {
    throw usageError(
      "WORK_GRAPH_CF_ACCESS_CLIENT_ID and WORK_GRAPH_CF_ACCESS_CLIENT_SECRET must be set together.",
    );
  }

  const sharedClientId = environment.CF_ACCESS_CLIENT_ID;
  const sharedClientSecret = environment.CF_ACCESS_CLIENT_SECRET;
  if (
    !workGraphClientId &&
    Boolean(sharedClientId) !== Boolean(sharedClientSecret)
  ) {
    throw usageError(
      "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set together.",
    );
  }

  const clientId = workGraphClientId || sharedClientId;
  const clientSecret = workGraphClientSecret || sharedClientSecret;

  const configuredOrigins = [
    ...splitOrigins(environment.WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS),
    ...options.accessAllowedOrigins,
  ].map(parseAllowedOrigin);

  if (clientId && clientSecret && !configuredOrigins.includes(apiUrl.origin)) {
    throw new CliError(
      "UNTRUSTED_ACCESS_ORIGIN",
      `Refusing to send Cloudflare Access credentials to ${apiUrl.origin}.`,
      EXIT_CODES.usage,
      {
        details: {
          hint:
            "Add the exact origin to WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS or --cf-access-allowed-origin.",
        },
      },
    );
  }

  return {
    apiUrl,
    accessHeaders:
      clientId && clientSecret
        ? {
            "CF-Access-Client-Id": clientId,
            "CF-Access-Client-Secret": clientSecret,
          }
        : {},
  };
};
