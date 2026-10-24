// Authenticated preview smoke test for the deployed realtime boundary. It
// creates independent Better Auth sessions for the seeded household owner and
// member, connects both directly to the preview Worker, and verifies committed
// pantry mutations are fanned out through the shared Durable Object room.
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import {
  previewApiOriginSchema,
  previewApiRequestURL,
} from "./preview-api-url";
import { createPreviewSessionCookie } from "./preview-session";
import { retryBoundedReadiness } from "./bounded-readiness";

const smokeEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z
    .httpUrl()
    .refine((value) => new URL(value).protocol === "https:"),
  BETTER_AUTH_SECRET: z.string().min(1),
  PREVIEW_API_URL: previewApiOriginSchema,
  PREVIEW_AUTH_PASSWORD: z.string().min(1),
});

const realtimeEventSchema = z.object({
  type: z.literal("resource.changed"),
  resourceType: z.literal("pantry"),
  resourceId: z.uuid(),
  revision: z.string().regex(/^\d+$/),
  operationId: z.uuid(),
  changeKind: z.enum([
    "pantry.replaced",
    "pantry.restored",
    "pantry.item-set",
    "pantry.item-removed",
  ]),
  pantry: z.object({
    resourceId: z.uuid(),
    revision: z.string().regex(/^\d+$/),
    operationId: z.uuid(),
    stock: z.record(z.string(), z.string()),
    itemVersions: z.record(z.string(), z.string()),
  }),
});

const subscriptionReadySchema = z.object({
  type: z.literal("subscription.ready"),
  resourceType: z.literal("pantry"),
  resourceId: z.uuid(),
});

type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

const env = smokeEnvSchema.parse(process.env);
const realtimeTimeoutMs = 15_000;
const realtimeReadinessTimeoutMs = 20_000;

function realtimeURL(): URL {
  const url = previewApiRequestURL(env.PREVIEW_API_URL, "/pantry/realtime");
  url.protocol = "wss:";
  return url;
}

function parseMessage(data: RawData): unknown {
  try {
    let text: string;
    if (Array.isArray(data)) {
      text = Buffer.concat(data).toString("utf8");
    } else if (data instanceof ArrayBuffer) {
      text = Buffer.from(data).toString("utf8");
    } else {
      text = Buffer.from(data).toString("utf8");
    }
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function waitForMessage<T>(
  socket: WebSocket,
  description: string,
  parse: (value: unknown) => T | undefined,
  timeoutMs = realtimeTimeoutMs,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`));
    }, timeoutMs);

    const onMessage = (data: RawData) => {
      const message = parse(parseMessage(data));
      if (message === undefined) return;
      cleanup();
      resolve(message);
    };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(
        new Error(
          `Realtime socket closed before ${description} (${code} ${reason.toString()})`,
        ),
      );
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.on("close", onClose);
    socket.on("error", onError);
  });
}

async function connectPantryAttempt(cookie: string, attempt: number): Promise<{
  socket: WebSocket;
  resourceId: string;
}> {
  const socket = new WebSocket(realtimeURL().href, {
    headers: { cookie },
    origin: new URL(env.BETTER_AUTH_URL).origin,
    perMessageDeflate: false,
  });
  try {
    const ready = await waitForMessage(
      socket,
      `subscription.ready on attempt ${attempt}`,
      (value) => subscriptionReadySchema.safeParse(value).data,
      realtimeReadinessTimeoutMs,
    );
    return { socket, resourceId: ready.resourceId };
  } catch (error) {
    socket.terminate();
    throw error;
  }
}

function connectPantry(cookie: string): Promise<{
  socket: WebSocket;
  resourceId: string;
}> {
  return retryBoundedReadiness(
    "Realtime subscription readiness",
    (attempt) => connectPantryAttempt(cookie, attempt),
    { attempts: 3, delayMs: 1_000 },
  );
}

function waitForPantryEvent(
  socket: WebSocket,
  operationId: string,
  changeKind: RealtimeEvent["changeKind"],
): Promise<RealtimeEvent> {
  return waitForMessage(socket, `${changeKind} event`, (value) => {
    const result = realtimeEventSchema.safeParse(value);
    return result.success &&
      result.data.operationId === operationId &&
      result.data.changeKind === changeKind
      ? result.data
      : undefined;
  });
}

async function mutatePantry(
  cookie: string,
  method: "PUT" | "DELETE",
  operationId: string,
): Promise<{ revision: string; operationId: string }> {
  const response = await fetch(
    previewApiRequestURL(env.PREVIEW_API_URL, "/pantry/items/garlic"),
    {
      method,
      headers: {
        cookie,
        origin: new URL(env.BETTER_AUTH_URL).origin,
        "idempotency-key": operationId,
        ...(method === "PUT" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "PUT"
        ? { body: JSON.stringify({ location: "fresh" }) }
        : {}),
      signal: AbortSignal.timeout(realtimeTimeoutMs),
    },
  );
  if (!response.ok) {
    throw new Error(
      `${method} /pantry/items/garlic returned ${response.status}: ${await response.text()}`,
    );
  }
  return z
    .object({ revision: z.string().regex(/^\d+$/), operationId: z.uuid() })
    .parse(await response.json());
}

const [ownerCookie, memberCookie] = await Promise.all([
  createPreviewSessionCookie(env, "household-owner@preview.invalid"),
  createPreviewSessionCookie(env, "household-member@preview.invalid"),
]);
const sockets: WebSocket[] = [];
let garlicWasRemoved = false;

try {
  await mutatePantry(ownerCookie, "PUT", crypto.randomUUID());
  const connections = await Promise.allSettled([
    connectPantry(ownerCookie),
    connectPantry(memberCookie),
  ]);
  for (const connection of connections) {
    if (connection.status === "fulfilled") {
      sockets.push(connection.value.socket);
    }
  }
  const [ownerResult, memberResult] = connections;
  if (ownerResult?.status !== "fulfilled") throw ownerResult?.reason;
  if (memberResult?.status !== "fulfilled") throw memberResult?.reason;
  const owner = ownerResult.value;
  const member = memberResult.value;
  if (owner.resourceId !== member.resourceId) {
    throw new Error(
      "Household owner and member joined different realtime rooms",
    );
  }

  const removeOperationId = crypto.randomUUID();
  const memberRemoval = waitForPantryEvent(
    member.socket,
    removeOperationId,
    "pantry.item-removed",
  );
  const [removal, removalEvent] = await Promise.all([
    mutatePantry(ownerCookie, "DELETE", removeOperationId).then((result) => {
      garlicWasRemoved = true;
      return result;
    }),
    memberRemoval,
  ]);
  if (
    removal.operationId !== removeOperationId ||
    removalEvent.resourceId !== owner.resourceId ||
    removalEvent.revision !== removal.revision ||
    removalEvent.pantry.resourceId !== removalEvent.resourceId ||
    removalEvent.pantry.revision !== removalEvent.revision ||
    removalEvent.pantry.operationId !== removalEvent.operationId ||
    "garlic" in removalEvent.pantry.stock
  ) {
    throw new Error(
      "Realtime removal did not match the committed pantry revision",
    );
  }

  const restoreOperationId = crypto.randomUUID();
  const ownerRestoration = waitForPantryEvent(
    owner.socket,
    restoreOperationId,
    "pantry.item-set",
  );
  const [restoration, restorationEvent] = await Promise.all([
    mutatePantry(memberCookie, "PUT", restoreOperationId).then((result) => {
      garlicWasRemoved = false;
      return result;
    }),
    ownerRestoration,
  ]);
  if (
    restoration.operationId !== restoreOperationId ||
    restorationEvent.resourceId !== owner.resourceId ||
    restorationEvent.revision !== restoration.revision ||
    restorationEvent.pantry.resourceId !== restorationEvent.resourceId ||
    restorationEvent.pantry.revision !== restorationEvent.revision ||
    restorationEvent.pantry.operationId !== restorationEvent.operationId ||
    restorationEvent.pantry.stock.garlic !== "fresh"
  ) {
    throw new Error(
      "Realtime restoration did not match the committed pantry revision",
    );
  }
  console.log("Preview household pantry realtime smoke test passed.");
} finally {
  if (garlicWasRemoved) {
    await mutatePantry(ownerCookie, "PUT", crypto.randomUUID()).catch(
      () => undefined,
    );
  }
  for (const socket of sockets) socket.terminate();
}
