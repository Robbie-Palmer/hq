const LOOPBACK_SERVICE_URL = "http://127.0.0.1:8765";
const TAILNET_IPV4_PREFIX = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
const PRIVATE_IPV4_PREFIX = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

export function inferReviewServiceUrl(hostname: string): string {
  const normalized = hostname.toLowerCase();
  const privateHost =
    TAILNET_IPV4_PREFIX.test(normalized) ||
    PRIVATE_IPV4_PREFIX.test(normalized) ||
    normalized.endsWith(".ts.net") ||
    (!normalized.includes(".") &&
      normalized !== "localhost" &&
      normalized !== "127.0.0.1");

  return privateHost ? `http://${hostname}:8765` : LOOPBACK_SERVICE_URL;
}

export { LOOPBACK_SERVICE_URL };
