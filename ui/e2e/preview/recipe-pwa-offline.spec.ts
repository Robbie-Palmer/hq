import type { Page } from "@playwright/test";
import {
  expect,
  previewReadinessTimeoutMs,
  previewSiteURL,
  test,
} from "./preview-test-helpers";

type OfflineReadiness = {
  controlled: boolean;
  sessionCached: boolean;
  snapshotDatabaseExists: boolean;
  snapshotStoreExists: boolean;
  scopedSnapshotStore: boolean;
  snapshotCount: number;
  recipeSnapshotExists: boolean;
  shoppingSnapshotExists: boolean;
  snapshotReadError: string | null;
};

type ShoppingOutboxEntry = {
  commandId: string;
  outcome: string;
};

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate((readinessTimeoutMs) => {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          onControllerChange,
        );
        callback();
      };
      const onControllerChange = () => finish(resolve);
      const timeout = window.setTimeout(
        () =>
          finish(() =>
            reject(new Error("The recipe service worker did not take control")),
          ),
        readinessTimeoutMs,
      );
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        onControllerChange,
      );
      void navigator.serviceWorker.ready.then(
        () => {
          if (navigator.serviceWorker.controller) finish(resolve);
        },
        (error: unknown) =>
          finish(() =>
            reject(
              error instanceof Error
                ? error
                : new Error("The recipe service worker did not activate"),
            ),
          ),
      );
    });
  }, previewReadinessTimeoutMs);
}

async function readOfflineReadiness(page: Page): Promise<OfflineReadiness> {
  return page.evaluate(async () => {
    const sessionCache = await caches.open("recipe-session-v1");
    const session = await sessionCache.match("/recipes/__offline-session");
    const databases = await indexedDB.databases();
    const snapshotDatabaseExists = databases.some(
      ({ name }) => name === "robbies-recipes",
    );
    let snapshotStoreExists = false;
    let scopedSnapshotStore = false;
    let snapshotCount = 0;
    let recipeSnapshotExists = false;
    let shoppingSnapshotExists = false;
    let snapshotReadError: string | null = null;

    if (snapshotDatabaseExists) {
      await new Promise<void>((resolve) => {
        const request = indexedDB.open("robbies-recipes");
        request.onerror = () => {
          snapshotReadError =
            request.error?.message ?? "could not open the snapshot database";
          resolve();
        };
        request.onsuccess = () => {
          const database = request.result;
          const snapshotStoreName = [
            "offline-snapshots",
            "recipe-snapshots",
          ].find((name) => database.objectStoreNames.contains(name));
          if (!snapshotStoreName) {
            database.close();
            resolve();
            return;
          }
          snapshotStoreExists = true;
          scopedSnapshotStore = snapshotStoreName === "offline-snapshots";
          const snapshots = database
            .transaction(snapshotStoreName)
            .objectStore(snapshotStoreName)
            .getAll();
          snapshots.onerror = () => {
            snapshotReadError =
              snapshots.error?.message ?? "could not read offline snapshots";
            database.close();
            resolve();
          };
          snapshots.onsuccess = () => {
            snapshotCount = snapshots.result.length;
            recipeSnapshotExists = !scopedSnapshotStore
              ? snapshotCount > 0
              : snapshots.result.some(
                  (snapshot: unknown) =>
                    typeof snapshot === "object" &&
                    snapshot !== null &&
                    "kind" in snapshot &&
                    snapshot.kind === "recipes",
                );
            shoppingSnapshotExists =
              scopedSnapshotStore &&
              snapshots.result.some(
                (snapshot: unknown) =>
                  typeof snapshot === "object" &&
                  snapshot !== null &&
                  "kind" in snapshot &&
                  snapshot.kind === "shopping-list",
              );
            database.close();
            resolve();
          };
        };
      });
    }

    return {
      controlled: navigator.serviceWorker.controller !== null,
      sessionCached: session !== undefined,
      snapshotDatabaseExists,
      snapshotStoreExists,
      scopedSnapshotStore,
      snapshotCount,
      recipeSnapshotExists,
      shoppingSnapshotExists,
      snapshotReadError,
    };
  });
}

function missingOfflinePrerequisites(readiness: OfflineReadiness): string[] {
  const missing: string[] = [];
  if (!readiness.controlled) missing.push("service-worker control");
  if (!readiness.sessionCached) missing.push("cached authenticated session");
  if (!readiness.snapshotDatabaseExists) {
    missing.push("recipe snapshot database");
  } else if (!readiness.snapshotStoreExists) {
    missing.push("recipe snapshot store");
  } else if (!readiness.recipeSnapshotExists) {
    missing.push(
      `recipe snapshot (found ${readiness.snapshotCount.toString()} stored snapshots)`,
    );
  }
  if (readiness.snapshotReadError) {
    missing.push(`readable recipe snapshots (${readiness.snapshotReadError})`);
  }
  return missing;
}

async function prepareOfflineRecipeSession(page: Page): Promise<void> {
  await waitForServiceWorkerControl(page);

  // A controlled reload makes the session request pass through the service
  // worker and creates a fresh query client whose successful bootstrap is
  // persisted to IndexedDB.
  await page.reload();
  await expect(
    page.getByText("Your recipe box", { exact: true }),
  ).toBeVisible();
  let readiness = await readOfflineReadiness(page);
  try {
    await expect
      .poll(
        async () => {
          readiness = await readOfflineReadiness(page);
          return missingOfflinePrerequisites(readiness);
        },
        {
          message:
            "recipe session and bootstrap were not saved for offline use",
          timeout: previewReadinessTimeoutMs,
        },
      )
      .toEqual([]);
  } catch (error) {
    throw new Error(
      `Offline recipe readiness timed out. Missing: ${missingOfflinePrerequisites(readiness).join(", ")}. Last state: ${JSON.stringify(readiness)}`,
      { cause: error },
    );
  }
}

async function clearOfflineRecipeSnapshots(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("robbies-recipes");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const snapshotStoreName = [
            "offline-snapshots",
            "recipe-snapshots",
          ].find((name) => database.objectStoreNames.contains(name));
          if (!snapshotStoreName) {
            database.close();
            reject(new Error("The offline snapshot store does not exist"));
            return;
          }
          const transaction = database.transaction(
            snapshotStoreName,
            "readwrite",
          );
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.objectStore(snapshotStoreName).clear();
        };
      }),
  );
}

async function readShoppingOutbox(page: Page): Promise<ShoppingOutboxEntry[]> {
  return page.evaluate(
    () =>
      new Promise<ShoppingOutboxEntry[]>((resolve, reject) => {
        const request = indexedDB.open("robbies-recipes");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("shopping-command-outbox")) {
            database.close();
            resolve([]);
            return;
          }
          const entries = database
            .transaction("shopping-command-outbox")
            .objectStore("shopping-command-outbox")
            .getAll();
          entries.onerror = () => {
            database.close();
            reject(entries.error);
          };
          entries.onsuccess = () => {
            resolve(
              entries.result.map((entry: ShoppingOutboxEntry) => ({
                commandId: entry.commandId,
                outcome: entry.outcome,
              })),
            );
            database.close();
          };
        };
      }),
  );
}

async function addShoppingExtra(page: Page, item: string): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/shopping-lists/current" &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await page
    .getByRole("combobox", { name: "Add a shopping-list item" })
    .fill(item);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await saved;
  await expect(
    page.getByRole("button", { name: item, exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
}

async function removeShoppingExtra(page: Page, item: string): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/shopping-lists/current" &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await page.getByRole("button", { name: `Remove ${item}` }).click();
  await saved;
}

async function expectOfflineDestination(page: Page, path: string) {
  await expect(page).toHaveURL(`${previewSiteURL.origin}${path}`);
  await expect(
    page.getByRole("heading", { name: "You're offline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recipe not found" }),
  ).toHaveCount(0);
}

test.describe.configure({ retries: 0, timeout: 90_000 });

test.describe("deployed recipe PWA offline navigation", () => {
  test("routes unavailable app navigation through the offline page", async ({
    createPreviewSession,
  }) => {
    const { context, page } = await createPreviewSession("household-owner");
    await prepareOfflineRecipeSession(page);
    await context.setOffline(true);

    const destinations = [
      { name: "Discover", path: "/recipes/discover" },
      { name: "Kitchen", path: "/recipes/kitchen" },
      { name: "Log", path: "/recipes/log" },
    ];

    for (const destination of destinations) {
      await page
        .getByRole("link", { name: destination.name, exact: true })
        .click();
      await expectOfflineDestination(page, destination.path);

      await page.getByRole("link", { name: "Back to recipes" }).click();
      await expect(page).toHaveURL(`${previewSiteURL.origin}/recipes`);
      await expect(
        page.getByText("Your recipe box", { exact: true }),
      ).toBeVisible();
    }

    await page.getByRole("link", { name: /^Notifications/ }).click();
    await expectOfflineDestination(page, "/recipes/notifications");
    await page.getByRole("link", { name: "Back to recipes" }).click();

    await page
      .getByRole("button", { name: "Account for Household owner" })
      .click();
    await page.getByRole("link", { name: "Profile", exact: true }).click();
    await expectOfflineDestination(page, "/recipes/profile");
    await page.getByRole("link", { name: "Back to recipes" }).click();

    await page
      .getByRole("button", { name: "Account for Household owner" })
      .click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expectOfflineDestination(page, "/recipes/settings");
  });

  test("opens the offline explanation from an unavailable diet notice", async ({
    createPreviewSession,
  }) => {
    const { context, page } = await createPreviewSession("household-owner");
    await prepareOfflineRecipeSession(page);
    await clearOfflineRecipeSnapshots(page);
    await context.setOffline(true);
    await page.reload();

    await expect(
      page.getByRole("alert").filter({
        hasText: "Diet preferences are unavailable.",
      }),
    ).toBeVisible();
    await page.getByRole("link", { name: "diet settings" }).click();

    await expectOfflineDestination(page, "/recipes/settings?section=diet");
  });

  test("reloads the current shopping trip from its scoped snapshot", async ({
    createPreviewSession,
  }) => {
    const { context, page } = await createPreviewSession("household-owner");
    await prepareOfflineRecipeSession(page);
    await page.getByRole("link", { name: "Shopping", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Shopping list." }),
    ).toBeVisible();

    const readiness = await readOfflineReadiness(page);
    if (!readiness.scopedSnapshotStore) {
      await context.setOffline(true);
      await page.reload();
      await expectOfflineDestination(page, "/recipes/shopping");
      return;
    }
    await expect
      .poll(
        async () => (await readOfflineReadiness(page)).shoppingSnapshotExists,
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload();

    await expect(
      page.getByRole("heading", { name: "Shopping list." }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({
        hasText: "Offline. Showing saved data from",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Your shopping list could not be loaded."),
    ).toHaveCount(0);
  });

  test("keeps an unacknowledged checklist change through an offline reload", async ({
    createPreviewSession,
  }, testInfo) => {
    const { context, page } = await createPreviewSession("household-owner");
    const item = `Offline queue item ${testInfo.parallelIndex.toString()}-${Date.now().toString()}`;
    await prepareOfflineRecipeSession(page);
    await page.getByRole("link", { name: "Shopping", exact: true }).click();
    await addShoppingExtra(page, item);

    await context.setOffline(true);
    await page.getByRole("button", { name: item, exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "1 offline shopping-list change is waiting to sync.",
    );
    await expect.poll(() => readShoppingOutbox(page)).toHaveLength(1);
    const [queued] = await readShoppingOutbox(page);
    if (!queued) throw new Error("The checklist command was not queued");

    await page.reload();
    await expect(
      page.getByRole("button", { name: item, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => readShoppingOutbox(page)).toEqual([queued]);

    const synced = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/shopping-lists/current/commands" &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await synced;
    await expect.poll(() => readShoppingOutbox(page)).toEqual([]);

    await page.reload();
    await expect(
      page.getByRole("button", { name: item, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await removeShoppingExtra(page, item);
  });

  test("replays the same command when its acknowledgement is lost", async ({
    createPreviewSession,
  }, testInfo) => {
    const { page } = await createPreviewSession("household-owner");
    const item = `Lost acknowledgement item ${testInfo.parallelIndex.toString()}-${Date.now().toString()}`;
    const deliveries: string[] = [];
    await prepareOfflineRecipeSession(page);
    await page.getByRole("link", { name: "Shopping", exact: true }).click();
    await addShoppingExtra(page, item);

    await page.route(
      "**/api/shopping-lists/current/commands",
      async (route) => {
        const body = route.request().postDataJSON() as { commandId: string };
        deliveries.push(body.commandId);
        if (deliveries.length === 1) {
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          await route.abort("connectionfailed");
          return;
        }
        await route.continue();
      },
    );

    await page.getByRole("button", { name: item, exact: true }).click();
    await expect
      .poll(async () => (await readShoppingOutbox(page))[0]?.outcome)
      .toBe("retry");
    await page.reload();

    await expect.poll(() => deliveries).toHaveLength(2);
    expect(deliveries[1]).toBe(deliveries[0]);
    await expect.poll(() => readShoppingOutbox(page)).toEqual([]);
    await expect(
      page.getByRole("button", { name: item, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await removeShoppingExtra(page, item);
  });
});
