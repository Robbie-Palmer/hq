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
  snapshotCount: number;
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

    const snapshotCount = snapshotDatabaseExists
      ? await new Promise<number>((resolve) => {
          const request = indexedDB.open("robbies-recipes");
          request.onerror = () => resolve(0);
          request.onsuccess = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains("recipe-snapshots")) {
              database.close();
              resolve(0);
              return;
            }
            const count = database
              .transaction("recipe-snapshots")
              .objectStore("recipe-snapshots")
              .count();
            count.onerror = () => {
              database.close();
              resolve(0);
            };
            count.onsuccess = () => {
              database.close();
              resolve(count.result);
            };
          };
        })
      : 0;

    return {
      controlled: navigator.serviceWorker.controller !== null,
      sessionCached: session !== undefined,
      snapshotCount,
    };
  });
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
  await expect
    .poll(() => readOfflineReadiness(page), {
      message: "recipe session and bootstrap were not saved for offline use",
      timeout: previewReadinessTimeoutMs,
    })
    .toMatchObject({
      controlled: true,
      sessionCached: true,
      snapshotCount: 1,
    });
}

async function clearOfflineRecipeSnapshots(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("robbies-recipes");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            "recipe-snapshots",
            "readwrite",
          );
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.objectStore("recipe-snapshots").clear();
        };
      }),
  );
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

test.describe.configure({ timeout: 90_000 });

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
      { name: "Shopping", path: "/recipes/shopping" },
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
});
