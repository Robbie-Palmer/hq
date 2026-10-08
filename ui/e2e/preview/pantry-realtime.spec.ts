import type { BrowserContext, Page, WebSocket } from "@playwright/test";
import {
  expect,
  expectPreviewStatus,
  type PreviewScenario,
  type PreviewSession,
  test,
} from "./preview-test-helpers";

const pantryRealtimePath = "/api/pantry/realtime";
const realtimeTimeoutMs = 10_000;

type ScenarioSession = {
  context: BrowserContext;
  page: Page;
};

type CreatePreviewSession = (
  scenario?: PreviewScenario,
) => Promise<PreviewSession>;

function parseFrame(payload: string | Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payload.toString());
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function createScenarioSession(
  createPreviewSession: CreatePreviewSession,
  scenario: "household-owner" | "household-member",
): Promise<ScenarioSession> {
  const session = await createPreviewSession(scenario);
  await session.context.addInitScript(
    ({ realtimePath }) => {
      const NativeWebSocket = window.WebSocket;
      Object.defineProperty(window, "WebSocket", {
        configurable: true,
        writable: true,
        value: class extends NativeWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            if (protocols === undefined) super(url);
            else super(url, protocols);

            if (new URL(this.url).pathname === realtimePath) {
              Object.defineProperty(window, "__closePantryRealtimeSocket", {
                configurable: true,
                value: () => this.close(4_000, "Playwright disconnect"),
              });
            }
          }
        },
      });
    },
    { realtimePath: pantryRealtimePath },
  );
  return session;
}

function waitForPantrySubscription(page: Page): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const listeners = new Map<
      WebSocket,
      {
        onClose: () => void;
        onFrame: (event: { payload: string | Buffer }) => void;
        onSocketError: (error: string) => void;
      }
    >();

    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(new Error("Pantry WebSocket did not become ready")),
        ),
      realtimeTimeoutMs,
    );

    const onWebSocket = (socket: WebSocket) => {
      if (new URL(socket.url()).pathname !== pantryRealtimePath) return;

      const onFrame = ({ payload }: { payload: string | Buffer }) => {
        const message = parseFrame(payload);
        if (
          message?.type === "subscription.ready" &&
          message.resourceType === "pantry"
        ) {
          finish(() => resolve(socket));
        }
      };
      const onSocketError = (error: string) => {
        finish(() => reject(new Error(`Pantry WebSocket failed: ${error}`)));
      };
      const onClose = () => {
        finish(() =>
          reject(new Error("Pantry WebSocket closed before becoming ready")),
        );
      };
      listeners.set(socket, { onClose, onFrame, onSocketError });
      socket.on("framereceived", onFrame);
      socket.on("socketerror", onSocketError);
      socket.on("close", onClose);
      if (socket.isClosed()) onClose();
    };

    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    }

    function cleanup() {
      clearTimeout(timeout);
      page.off("websocket", onWebSocket);
      for (const [socket, handlers] of listeners) {
        socket.off("framereceived", handlers.onFrame);
        socket.off("socketerror", handlers.onSocketError);
        socket.off("close", handlers.onClose);
      }
      listeners.clear();
    }

    page.on("websocket", onWebSocket);
  });
}

function waitForSocketClose(socket: WebSocket): Promise<void> {
  return socket
    .waitForEvent("close", { timeout: realtimeTimeoutMs })
    .then(() => undefined);
}

function waitForPantryChange(
  socket: WebSocket,
  operationId: Promise<string>,
  changeKind: string,
  ingredientSlug: string,
  expectedLocation: string | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let expectedOperationId: string | undefined;
    let settled = false;
    const pendingFrames: Record<string, unknown>[] = [];
    const expectedState = expectedLocation ?? "absent";
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              `Pantry WebSocket did not receive ${changeKind} for ${ingredientSlug} (${expectedState})`,
            ),
          ),
        ),
      realtimeTimeoutMs,
    );

    const matchesExpectedChange = (
      message: Record<string, unknown>,
      expectedOperationId: string,
    ) => {
      if (message.operationId !== expectedOperationId) return false;
      if (
        !message.pantry ||
        typeof message.pantry !== "object" ||
        !("stock" in message.pantry) ||
        !message.pantry.stock ||
        typeof message.pantry.stock !== "object" ||
        Array.isArray(message.pantry.stock)
      ) {
        return false;
      }
      const stock = message.pantry.stock as Record<string, unknown>;
      return expectedLocation === undefined
        ? !Object.hasOwn(stock, ingredientSlug)
        : stock[ingredientSlug] === expectedLocation;
    };

    const onFrame = ({ payload }: { payload: string | Buffer }) => {
      const message = parseFrame(payload);
      if (
        message?.type !== "resource.changed" ||
        message.resourceType !== "pantry" ||
        message.changeKind !== changeKind
      ) {
        return;
      }
      if (expectedOperationId === undefined) {
        pendingFrames.push(message);
        return;
      }
      if (!matchesExpectedChange(message, expectedOperationId)) return;
      finish(resolve);
    };
    const onSocketError = (error: string) => {
      finish(() => reject(new Error(`Pantry WebSocket failed: ${error}`)));
    };
    const onClose = () => {
      finish(() =>
        reject(new Error("Pantry WebSocket closed before receiving a change")),
      );
    };

    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    }

    function cleanup() {
      clearTimeout(timeout);
      socket.off("framereceived", onFrame);
      socket.off("socketerror", onSocketError);
      socket.off("close", onClose);
    }

    socket.on("framereceived", onFrame);
    socket.on("socketerror", onSocketError);
    socket.on("close", onClose);
    if (socket.isClosed()) onClose();

    void operationId.then(
      (value) => {
        if (settled) return;
        if (!value) {
          finish(() =>
            reject(new Error("Pantry request omitted its operation ID")),
          );
          return;
        }
        expectedOperationId = value;
        const matchingFrame = pendingFrames.find((message) =>
          matchesExpectedChange(message, value),
        );
        if (matchingFrame) finish(resolve);
      },
      (error: unknown) => {
        finish(() =>
          reject(
            error instanceof Error
              ? error
              : new Error("Could not observe the pantry request"),
          ),
        );
      },
    );
  });
}

function waitForPantryOperationId(
  page: Page,
  method: string,
  path: string,
): Promise<string> {
  return page
    .waitForRequest(
      (request) =>
        request.method() === method && new URL(request.url()).pathname === path,
      { timeout: realtimeTimeoutMs },
    )
    .then((request) => {
      const operationId = request.headers()["idempotency-key"];
      if (!operationId)
        throw new Error("Pantry request omitted its operation ID");
      return operationId;
    });
}

async function disconnectPantrySocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const closeSocket = (
      window as typeof window & {
        __closePantryRealtimeSocket?: () => void;
      }
    ).__closePantryRealtimeSocket;
    if (!closeSocket)
      throw new Error("Pantry WebSocket test control is absent");
    closeSocket();
  });
}

async function openKitchen(session: ScenarioSession): Promise<WebSocket> {
  const subscription = waitForPantrySubscription(session.page);
  await session.page.goto("/recipes/kitchen");
  const socket = await subscription;
  await expect(
    session.page.getByText("Preview Shared Household's kitchen.", {
      exact: true,
    }),
  ).toBeVisible();
  return socket;
}

async function restorePantryItem(
  context: BrowserContext,
  ingredientSlug: string,
  operationId = crypto.randomUUID(),
): Promise<void> {
  await expectPreviewStatus(
    context,
    `/api/pantry/items/${ingredientSlug}`,
    {
      data: { location: "fresh" },
      headers: {
        "idempotency-key": operationId,
      },
      method: "PUT",
    },
    200,
  );
}

test.describe.configure({ timeout: 90_000 });

test.describe("deployed household pantry realtime", () => {
  test("fans a committed pantry change out to another household session", async ({
    createPreviewSession,
  }) => {
    let pantryWasChanged = false;
    const owner = await createScenarioSession(
      createPreviewSession,
      "household-owner",
    );
    const member = await createScenarioSession(
      createPreviewSession,
      "household-member",
    );
    try {
      await restorePantryItem(owner.context, "garlic");

      const [ownerSocket, memberSocket] = await Promise.all([
        openKitchen(owner),
        openKitchen(member),
      ]);
      await expect(
        owner.page.getByRole("button", { name: "Remove Garlic" }),
      ).toBeVisible();
      await expect(
        member.page.getByRole("button", { name: "Remove Garlic" }),
      ).toBeVisible();

      const removalOperationId = waitForPantryOperationId(
        owner.page,
        "DELETE",
        "/api/pantry/items/garlic",
      );
      const memberRemoval = waitForPantryChange(
        memberSocket,
        removalOperationId,
        "pantry.item-removed",
        "garlic",
        undefined,
      );
      await owner.page.getByRole("button", { name: "Remove Garlic" }).click();
      pantryWasChanged = true;
      await memberRemoval;
      await expect(
        member.page.getByRole("button", { name: "Remove Garlic" }),
      ).toHaveCount(0);

      const restorationOperationId = crypto.randomUUID();
      const ownerRestoration = waitForPantryChange(
        ownerSocket,
        Promise.resolve(restorationOperationId),
        "pantry.item-set",
        "garlic",
        "fresh",
      );
      await restorePantryItem(member.context, "garlic", restorationOperationId);
      await ownerRestoration;
      await expect(
        owner.page.getByRole("button", { name: "Remove Garlic" }),
      ).toBeVisible();
      pantryWasChanged = false;
    } finally {
      if (pantryWasChanged) {
        await restorePantryItem(owner.context, "garlic").catch(() => undefined);
      }
    }
  });

  test("recovers the canonical pantry after a household session reconnects", async ({
    createPreviewSession,
  }) => {
    let pantryWasChanged = false;
    const owner = await createScenarioSession(
      createPreviewSession,
      "household-owner",
    );
    const member = await createScenarioSession(
      createPreviewSession,
      "household-member",
    );
    try {
      await restorePantryItem(owner.context, "carrot");
      const [, memberSocket] = await Promise.all([
        openKitchen(owner),
        openKitchen(member),
      ]);

      const memberDisconnected = waitForSocketClose(memberSocket);
      await member.context.setOffline(true);
      await disconnectPantrySocket(member.page);
      await memberDisconnected;
      await owner.page.getByRole("button", { name: "Remove Carrot" }).click();
      pantryWasChanged = true;
      await expect(
        owner.page.getByRole("button", { name: "Remove Carrot" }),
      ).toHaveCount(0);

      const reconnected = waitForPantrySubscription(member.page);
      await member.context.setOffline(false);
      await reconnected;
      await expect(
        member.page.getByRole("button", { name: "Remove Carrot" }),
      ).toHaveCount(0, { timeout: realtimeTimeoutMs });
    } finally {
      if (pantryWasChanged) {
        await owner.context.setOffline(false).catch(() => undefined);
        await restorePantryItem(owner.context, "carrot").catch(() => undefined);
      }
    }
  });
});
