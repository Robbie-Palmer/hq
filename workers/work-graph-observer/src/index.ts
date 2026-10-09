import { closeDb, createDb, GitHubDeliveryConsumer } from "work-graph-db";
import type { GitHubDelivery } from "work-graph-domain";
export type { GitHubDelivery } from "work-graph-domain";

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 1_048_576;
const DELIVERY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SUPPORTED_EVENTS = new Set([
  "deployment_status",
  "pull_request",
  "workflow_run",
]);

export interface ObserverBindings {
  readonly HYPERDRIVE: Hyperdrive;
  readonly DELIVERIES: Queue<GitHubDelivery>;
  readonly GITHUB_ALLOWED_INSTALLATION_IDS: string;
  readonly GITHUB_ALLOWED_REPOSITORIES: string;
  readonly GITHUB_WEBHOOK_SECRET: string;
}

type JsonRecord = Record<string, unknown>;

function json(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: JsonRecord, key: string): boolean {
  return typeof record[key] === "string" && record[key].length > 0;
}

function hasPositiveInteger(record: JsonRecord, key: string): boolean {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isValidEventPayload(event: string, payload: JsonRecord): boolean {
  if (!hasString(payload, "action")) return false;

  if (event === "pull_request") {
    const pullRequest = payload.pull_request;
    return isRecord(pullRequest) && hasPositiveInteger(pullRequest, "number");
  }
  if (event === "workflow_run") {
    const workflowRun = payload.workflow_run;
    return (
      isRecord(workflowRun) &&
      hasPositiveInteger(workflowRun, "id") &&
      hasString(workflowRun, "head_sha")
    );
  }
  if (event === "deployment_status") {
    const deployment = payload.deployment;
    const status = payload.deployment_status;
    return (
      isRecord(deployment) &&
      hasPositiveInteger(deployment, "id") &&
      hasString(deployment, "sha") &&
      isRecord(status) &&
      hasPositiveInteger(status, "id") &&
      hasString(status, "state")
    );
  }
  return false;
}

function parseStringAllowlist(raw: string): ReadonlySet<string> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some((value) => typeof value !== "string" || value.trim() === "")
    ) {
      return null;
    }
    return new Set(parsed.map((value) => value.trim().toLowerCase()));
  } catch {
    return null;
  }
}

function parseInstallationAllowlist(raw: string): ReadonlySet<number> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some(
        (value) =>
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value <= 0,
      )
    ) {
      return null;
    }
    return new Set(parsed);
  } catch {
    return null;
  }
}

function hexBytes(value: string): Uint8Array | null {
  if (!/^[\da-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function verifyGitHubSignature(
  body: ArrayBuffer,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature?.startsWith("sha256=") || secret.length < 32) return false;
  const signatureBytes = hexBytes(signature.slice("sha256=".length));
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, body);
}

async function payloadDigest(body: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function payloadIdentity(payload: JsonRecord):
  | { installationId: number; repository: string }
  | undefined {
  const installation = payload.installation;
  const repository = payload.repository;
  if (
    !isRecord(installation) ||
    !hasPositiveInteger(installation, "id") ||
    !isRecord(repository) ||
    !hasString(repository, "full_name")
  ) {
    return undefined;
  }
  const repositoryName = repository.full_name as string;
  if (!REPOSITORY_PATTERN.test(repositoryName)) return undefined;
  return {
    installationId: installation.id as number,
    repository: repositoryName.toLowerCase(),
  };
}

function policyRejection(
  identity: { installationId: number; repository: string },
  env: ObserverBindings,
): Response | undefined {
  const allowedInstallations = parseInstallationAllowlist(
    env.GITHUB_ALLOWED_INSTALLATION_IDS,
  );
  const allowedRepositories = parseStringAllowlist(
    env.GITHUB_ALLOWED_REPOSITORIES,
  );
  if (!allowedInstallations || !allowedRepositories) {
    console.error("Observer allowlists are not configured");
    return json("Observer policy unavailable", 503);
  }
  if (
    !allowedInstallations.has(identity.installationId) ||
    !allowedRepositories.has(identity.repository)
  ) {
    return json("GitHub installation or repository is not allowed", 403);
  }
  return undefined;
}

async function readBody(request: Request): Promise<ArrayBuffer | Response> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return json("Invalid Content-Length", 400);
    }
    if (parsedLength > MAX_BODY_BYTES) return json("Payload too large", 413);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return json("Payload too large", 413);
  return body;
}

export async function handleWebhook(
  request: Request,
  env: ObserverBindings,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/webhooks/github") return json("Not found", 404);
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "allow": "POST", "content-type": "application/json" },
    });
  }

  const bodyResult = await readBody(request);
  if (bodyResult instanceof Response) return bodyResult;
  if (
    !(await verifyGitHubSignature(
      bodyResult,
      request.headers.get("x-hub-signature-256"),
      env.GITHUB_WEBHOOK_SECRET,
    ))
  ) {
    return json("Invalid webhook signature", 401);
  }

  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  if (!event || !SUPPORTED_EVENTS.has(event)) {
    return json("Unsupported GitHub event", 400);
  }
  if (!deliveryId || !DELIVERY_ID_PATTERN.test(deliveryId)) {
    return json("Invalid GitHub delivery ID", 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bodyResult)) as unknown;
  } catch {
    return json("Malformed JSON payload", 400);
  }
  if (!isRecord(payload) || !isValidEventPayload(event, payload)) {
    return json("Malformed GitHub event payload", 400);
  }
  const identity = payloadIdentity(payload);
  if (!identity) return json("Missing GitHub installation or repository", 400);

  const rejection = policyRejection(identity, env);
  if (rejection) return rejection;

  await env.DELIVERIES.send({
    deliveryId,
    event,
    installationId: identity.installationId,
    payload,
    payloadDigest: await payloadDigest(bodyResult),
    receivedAt: new Date().toISOString(),
    repository: identity.repository,
  });
  return Response.json({ accepted: true, deliveryId }, { status: 202 });
}

export default {
  fetch: handleWebhook,
  async queue(batch, env) {
    const db = createDb(env.HYPERDRIVE.connectionString, { maxConnections: 1 });
    try {
      const consumer = new GitHubDeliveryConsumer(db);
      for (const message of batch.messages) {
        try {
          const disposition = await consumer.consume(message.body); // NOSONAR: Serialize messages on the single database connection.
          console.log(JSON.stringify({ deliveryId: message.body.deliveryId, disposition }));
          message.ack();
        } catch {
          console.error(JSON.stringify({ deliveryId: message.body.deliveryId, disposition: "failed" }));
          message.retry();
        }
      }
    } finally {
      await closeDb(db);
    }
  },
} satisfies ExportedHandler<ObserverBindings, GitHubDelivery>;
